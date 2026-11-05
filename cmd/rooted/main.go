package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"rooted/internal/api"
	"rooted/internal/config"
	"rooted/internal/framemempool"
	"rooted/internal/ingest"
	"rooted/internal/payloadwatch"
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
		fmt.Fprintln(os.Stdout, "Rooted: Ethereum block-pipeline observations\nUsage: rooted [serve | migrate | ingest SLOT | replay PATH.json | frame-sync [gateway|miner] [HASH] | frame-submit SIGNED.json HASH [gateway|miner] | help]")
		return nil
	}
	c, err := config.Load()
	if err != nil {
		return err
	}
	fc, err := config.LoadFrame()
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
	watch := &payloadwatch.Engine{Pool: repo.Pool, Policy: payloadwatch.Policy{LateAfter: c.LateAfter, MissingAfter: c.MissingAfter, PTCQuorum: c.PTCQuorum, PTCSize: c.PTCSize}}
	frames := &framemempool.Store{Pool: repo.Pool, ObservationWindow: fc.ObservationWindow}
	frameCollectors := map[string]*framemempool.Collector{}
	for node, endpoint := range map[string]string{"gateway": fc.Gateway, "miner": fc.Miner} {
		u, _ := url.Parse(endpoint)
		if u.Scheme == "https" {
			u.Scheme = "wss"
		} else {
			u.Scheme = "ws"
		}
		frameCollectors[node] = &framemempool.Collector{Scope: framemempool.Scope{Network: fc.Network, Mode: "live", Node: node}, Store: frames, Node: framemempool.NewClient(endpoint, c.RequestTimeout), Execution: framemempool.NewClient(fc.Execution, c.RequestTimeout), ChainID: fc.Chain, Genesis: fc.Genesis, WSURL: u.String(), Interval: fc.Poll, Logger: logger}
	}
	switch command {
	case "frame-sync":
		node := "gateway"
		if len(os.Args) > 2 {
			node = os.Args[2]
		}
		adapter := frameCollectors[node]
		if len(os.Args) == 4 {
			err = adapter.SyncHash(ctx, os.Args[3])
		} else {
			err = adapter.Poll(ctx)
		}
		if err != nil {
			return err
		}
		states, err := frames.States(ctx, adapter.Scope, "", 100)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"scope": adapter.Scope, "data": states})
	case "frame-submit":
		node := "gateway"
		if len(os.Args) == 5 {
			node = os.Args[4]
		}
		file, err := os.Open(os.Args[2])
		if err != nil {
			return errors.New("unable to open signed transaction file")
		}
		defer file.Close()
		body, err := io.ReadAll(io.LimitReader(file, (2<<20)+1))
		if err != nil || len(body) > 2<<20 {
			return errors.New("signed transaction file exceeds limit or cannot be read")
		}
		result, err := frameCollectors[node].Submit(ctx, body, os.Args[3])
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
	case "migrate":
		logger.Info("database migrations applied")
		return nil
	case "replay":
		file, err := os.Open(os.Args[2])
		if err != nil {
			return errors.New("unable to open replay dataset")
		}
		defer file.Close()
		result, err := payloadwatch.Replay(ctx, watch, file, c.Network)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(result)
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
		if err = payloadwatch.RecordSnapshot(fetchCtx, watch, snapshot.Observation, c.SourceID, "live"); err != nil {
			return err
		}
		if err = watch.Reconcile(fetchCtx, c.Network, "live", c.SourceID, slot, snapshot.Observation.BlockRoot, time.Now().UTC()); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(api.ObservationResponse{Data: snapshot.Observation})
	case "serve":
		workerCtx, stopWorkers := context.WithCancel(ctx)
		var workers sync.WaitGroup
		defer func() { stopWorkers(); workers.Wait() }()
		if c.WatchEnabled {
			if err = watch.CloseOldSessions(ctx, c.Network, c.SourceID); err != nil {
				return err
			}
			wake := make(chan uint64, 1)
			poller := &payloadwatch.Poller{Engine: watch, Collector: collector, Repository: repo, Beacon: collector.Beacon, Network: c.Network, SourceID: c.SourceID, Interval: c.PollInterval, Lookback: c.Lookback, MaxCatchup: c.MaxCatchup, Wake: wake, Logger: logger}
			workers.Add(1)
			go func() { defer workers.Done(); poller.Run(workerCtx) }()
			if c.StreamEnabled {
				if err = watch.SetProgress(ctx, c.Network, c.SourceID, "stream", "waiting_for_network_verification", nil); err != nil {
					return err
				}
				stream := &payloadwatch.Stream{VerifyNetwork: collector.VerifyNetwork, Engine: watch, URL: c.BeaconURL, Network: c.Network, SourceID: c.SourceID, Logger: logger, Wake: wake}
				workers.Add(1)
				go func() { defer workers.Done(); stream.Run(workerCtx) }()
			} else if err = watch.SetProgress(ctx, c.Network, c.SourceID, "stream", "disabled", nil); err != nil {
				return err
			}
		} else {
			if err = watch.SetProgress(ctx, c.Network, c.SourceID, "stream", "disabled", nil); err != nil {
				return err
			}
			if err = watch.SetProgress(ctx, c.Network, c.SourceID, "poll", "disabled", nil); err != nil {
				return err
			}
		}
		if fc.Enabled {
			for _, adapter := range frameCollectors {
				workers.Add(1)
				go func(a *framemempool.Collector) { defer workers.Done(); a.Run(workerCtx) }(adapter)
				if fc.Stream {
					workers.Add(1)
					go func(a *framemempool.Collector) { defer workers.Done(); a.Stream(workerCtx) }(adapter)
				}
			}
		}
		handler := (&api.Server{Repository: repo, Collector: collector, Network: c.Network, Logger: logger, Watch: watch, SourceID: c.SourceID, Frames: frames, FrameNetwork: fc.Network}).Handler()
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
		return fmt.Errorf("unknown command %q; use serve, migrate, ingest SLOT, replay PATH.json, frame-sync, or frame-submit", command)
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
	case "replay":
		if len(args) == 2 && args[1] != "" {
			return "replay", 0, nil
		}
		return "", 0, errors.New("usage: rooted replay PATH.json")
	case "frame-sync":
		if len(args) > 3 {
			return "", 0, errors.New("usage: rooted frame-sync [gateway|miner] [HASH]")
		}
		if len(args) > 1 && args[1] != "gateway" && args[1] != "miner" {
			return "", 0, errors.New("frame node must be gateway or miner")
		}
		if len(args) == 3 && !ingest.ValidRoot(args[2]) {
			return "", 0, errors.New("frame transaction hash must be 32 bytes")
		}
		return "frame-sync", 0, nil
	case "frame-submit":
		if (len(args) != 3 && len(args) != 4) || args[1] == "" || !ingest.ValidRoot(args[2]) {
			return "", 0, errors.New("usage: rooted frame-submit SIGNED.json EXPECTED_HASH [gateway|miner]")
		}
		if len(args) == 4 && args[3] != "gateway" && args[3] != "miner" {
			return "", 0, errors.New("frame node must be gateway or miner")
		}
		return "frame-submit", 0, nil
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
	return "", 0, errors.New("usage: rooted [serve | migrate | ingest SLOT | replay PATH.json | frame-sync | frame-submit | help]")
}
