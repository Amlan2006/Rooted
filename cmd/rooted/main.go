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
	"strings"
	"sync"
	"syscall"
	"time"

	"rooted/internal/analysis"
	"rooted/internal/api"
	"rooted/internal/config"
	"rooted/internal/framemempool"
	"rooted/internal/ingest"
	"rooted/internal/payloadwatch"
	"rooted/internal/profiler"
	"rooted/internal/providers"
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
		fmt.Fprintln(os.Stdout, "Rooted: Ethereum block-pipeline observations\nUsage: rooted [serve | migrate | ingest SLOT | replay PATH.json | analyze[-fork] BLOCK_HASH [TX_HASH,...] | frame-sync [gateway|miner] [HASH] | frame-submit SIGNED.json HASH [gateway|miner] | compare-providers [BLOCK_HASH] | profile BLOCK_HASH | profile-replay PROFILE_ID | profile-capture PROFILE_ID | help]")
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
	ac, err := config.LoadAnalysis()
	if err != nil {
		return err
	}
	pc, err := config.LoadProviders()
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
	analysisStore := &analysis.Store{Pool: repo.Pool}
	analyzer := &analysis.Collector{Beacon: remote.New(c.BeaconURL, c.RequestTimeout), AnchorNumber: ac.AnchorNumber, AnchorHash: ac.AnchorHash, Execution: remote.New(c.ExecutionURL, c.RequestTimeout), Trace: remote.New(ac.TraceURL, c.RequestTimeout), Network: c.Network, Mode: "live", ChainID: c.ChainID, Native: true, OpcodeLimit: 20000}
	providerStore := &providers.Store{Pool: repo.Pool}
	providerChecks := &providers.Collector{Providers: [2]providers.Endpoint{{ID: "primary", Execution: c.ExecutionURL, Beacon: c.BeaconURL}, {ID: "reference", Execution: pc.ExecutionURL, Beacon: pc.BeaconURL}}, AnchorNumber: ac.AnchorNumber, AnchorHash: ac.AnchorHash, GenesisRoot: c.GenesisRoot, Timeout: 8 * time.Second}
	profileStore := &profiler.Store{Pool: repo.Pool}
	replayBinary := os.Getenv("ROOTED_REPLAY_BINARY")
	if replayBinary == "" {
		replayBinary = ".tools/rooted-replay"
	}
	profileCollector := &profiler.Collector{RPC: remote.New(c.ExecutionURL, c.RequestTimeout), Endpoint: c.ExecutionURL, Binary: replayBinary, AnchorNumber: ac.AnchorNumber, AnchorHash: ac.AnchorHash}
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
	case "compare-providers":
		if c.Network != "sepolia" {
			return errors.New("provider comparison requires Sepolia configuration")
		}
		bounded, done := context.WithTimeout(ctx, 75*time.Second)
		defer done()
		hash := ""
		if len(os.Args) == 3 {
			hash = os.Args[2]
		} else {
			hash, err = providerChecks.Latest(bounded)
			if err != nil {
				return err
			}
		}
		report, err := providerChecks.Compare(bounded, hash)
		if err != nil {
			return err
		}
		if bounded.Err() != nil {
			return bounded.Err()
		}
		if err = providerStore.Save(bounded, report); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"data": report})
	case "profile", "profile-replay":
		if c.Network != "sepolia" {
			return errors.New("profiling requires Sepolia configuration")
		}
		bounded, done := context.WithTimeout(ctx, 90*time.Second)
		defer done()
		var report profiler.Report
		var capture []byte
		if command == "profile" {
			report, capture, err = profileCollector.Capture(bounded, os.Args[2])
		} else {
			reports, readErr := profileStore.List(bounded, strings.ToLower(os.Args[2]))
			if readErr != nil || len(reports) != 1 {
				return errors.New("saved profile unavailable")
			}
			capture, err = profileStore.Capture(bounded, reports[0].ID)
			if err != nil {
				return err
			}
			metadata := reports[0]
			metadata.CaptureMode = "recorded_capture"
			if metadata.InputCapturedAt.IsZero() {
				metadata.InputCapturedAt = metadata.CapturedAt
			}
			report, capture, err = profileCollector.Measure(bounded, metadata, capture)
		}
		if err != nil {
			return err
		}
		if err = profileStore.Correlate(bounded, &report); err != nil {
			return err
		}
		if err = profileStore.Save(bounded, report, capture); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"data": report})
	case "profile-capture":
		capture, err := profileStore.Capture(ctx, strings.ToLower(os.Args[2]))
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(capture)
		return err
	case "analyze", "analyze-fork":
		selected := []string{}
		if len(os.Args) == 4 {
			selected = strings.Split(os.Args[3], ",")
		}
		target := analyzer
		if command == "analyze-fork" {
			target = &analysis.Collector{AnchorNumber: ac.AnchorNumber, AnchorHash: ac.AnchorHash, Execution: remote.New(ac.ForkURL, c.RequestTimeout), Trace: remote.New(ac.ForkURL, c.RequestTimeout), Network: c.Network + "-fork", Mode: "fork", ChainID: "31337", Native: false, OpcodeLimit: 20000}
		}
		bounded, done := context.WithTimeout(ctx, 4*time.Minute)
		defer done()
		snapshot, err := target.Fetch(bounded, os.Args[2], selected)
		if err != nil {
			return err
		}
		if err = analysisStore.Save(bounded, snapshot); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"data": snapshot.Run})
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
		handler := (&api.Server{Repository: repo, Collector: collector, Network: c.Network, Logger: logger, Watch: watch, SourceID: c.SourceID, Analysis: analysisStore, Analyzer: analyzer, Frames: frames, FrameNetwork: fc.Network, Providers: providerStore, ProviderChecks: providerChecks, ProviderGate: make(chan struct{}, 1), Profiles: profileStore, Profiler: profileCollector, ProfileGate: make(chan struct{}, 1)}).Handler()
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
		return fmt.Errorf("unknown command %q; use serve, migrate, ingest SLOT, replay PATH.json, analyze, analyze-fork, frame-sync, or frame-submit", command)
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
	case "compare-providers":
		if len(args) == 1 || (len(args) == 2 && ingest.ValidRoot(args[1])) {
			return args[0], 0, nil
		}
		return "", 0, errors.New("usage: rooted compare-providers [BLOCK_HASH]")
	case "profile", "profile-replay", "profile-capture":
		if len(args) == 2 && ingest.ValidRoot(args[1]) {
			return args[0], 0, nil
		}
		return "", 0, fmt.Errorf("usage: rooted %s IMMUTABLE_HASH", args[0])
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
	case "analyze", "analyze-fork":
		if len(args) < 2 || len(args) > 3 || !ingest.ValidRoot(args[1]) {
			return "", 0, errors.New("usage: rooted analyze[-fork] BLOCK_HASH [TX_HASH,TX_HASH,...]")
		}
		if len(args) == 3 {
			parts := strings.Split(args[2], ",")
			if len(parts) == 0 || len(parts) > 4 {
				return "", 0, errors.New("at most four selected transaction hashes are allowed")
			}
			seen := map[string]bool{}
			for _, value := range parts {
				value = strings.ToLower(value)
				if !ingest.ValidRoot(value) || seen[value] {
					return "", 0, errors.New("selected transaction hashes must be unique 32-byte values")
				}
				seen[value] = true
			}
		}
		return args[0], 0, nil
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
	return "", 0, errors.New("usage: rooted [serve | migrate | ingest SLOT | replay PATH.json | analyze[-fork] BLOCK_HASH [TX_HASH,...] | frame-sync | frame-submit | help]")
}
