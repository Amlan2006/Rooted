package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"rooted/internal/api"
	"rooted/internal/config"
	"rooted/internal/ingest"
	"rooted/internal/remote"
	"rooted/internal/storage"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	if err := run(logger); err != nil {
		logger.Error("command failed", "error", err.Error())
		os.Exit(1)
	}
}
func run(logger *slog.Logger) error {
	command, slot, err := parseArguments(os.Args[1:])
	if err != nil {
		return err
	}
	if command == "help" {
		fmt.Fprintln(os.Stdout, "Rooted: Ethereum block-pipeline observations\nUsage: rooted [serve | migrate | ingest SLOT | help]")
		return nil
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	repo, err := storage.Open(startup, c.DatabaseURL)
	if err != nil {
		cancel()
		return errors.New("unable to connect to PostgreSQL; check DATABASE_URL and database readiness")
	}
	defer repo.Close()
	err = repo.Migrate(startup)
	cancel()
	if err != nil {
		return errors.New("database migration failed")
	}
	collector := &ingest.Collector{Beacon: remote.New(c.BeaconURL, c.RequestTimeout), Execution: remote.New(c.ExecutionURL, c.RequestTimeout), Network: c.Network, ChainID: c.ChainID, GenesisRoot: c.GenesisRoot}
	switch command {
	case "migrate":
		logger.Info("database migrations applied")
		return nil
	case "ingest":
		fetchCtx, fetchCancel := context.WithTimeout(ctx, 90*time.Second)
		defer fetchCancel()
		snapshot, err := collector.Fetch(fetchCtx, slot)
		if err != nil {
			return err
		}
		if err = repo.Save(fetchCtx, snapshot); err != nil {
			return errors.New("unable to persist observation")
		}
		return json.NewEncoder(os.Stdout).Encode(api.ObservationResponse{Data: snapshot.Observation})
	case "serve":
		handler := (&api.Server{Repository: repo, Collector: collector, Network: c.Network, Logger: logger}).Handler()
		server := &http.Server{Addr: c.ListenAddr, Handler: handler, BaseContext: func(net.Listener) context.Context { return ctx }, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 100 * time.Second, IdleTimeout: 60 * time.Second}
		finished := make(chan error, 1)
		go func() {
			logger.Info("API listening", "address", c.ListenAddr, "network", c.Network)
			finished <- server.ListenAndServe()
		}()
		select {
		case err := <-finished:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-ctx.Done():
			shutdown, done := context.WithTimeout(context.Background(), 10*time.Second)
			defer done()
			if err := server.Shutdown(shutdown); err != nil {
				_ = server.Close()
				return err
			}
			return nil
		}
	default:
		return fmt.Errorf("unknown command %q; use serve, ingest SLOT, or migrate", command)
	}
}

// Reject malformed commands before opening or migrating the database.
func parseArguments(args []string) (string, uint64, error) {
	if len(args) == 0 {
		return "serve", 0, nil
	}
	switch args[0] {
	case "help", "--help", "-h":
		if len(args) == 1 {
			return "help", 0, nil
		}
	case "serve", "migrate":
		if len(args) == 1 {
			return args[0], 0, nil
		}
	case "ingest":
		if len(args) != 2 {
			return "", 0, errors.New("usage: rooted ingest SLOT")
		}
		slot, err := strconv.ParseUint(args[1], 10, 64)
		if err != nil {
			return "", 0, errors.New("slot must be an unsigned decimal integer")
		}
		return "ingest", slot, nil
	}
	return "", 0, errors.New("usage: rooted [serve | migrate | ingest SLOT | help]")
}
