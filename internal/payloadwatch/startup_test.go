package payloadwatch

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"rooted/internal/config"
	"rooted/internal/domain"
	"rooted/internal/ingest"
	"rooted/internal/remote"
	"rooted/internal/storage"
	"sync/atomic"
	"testing"
	"time"
)

type blockedHead struct {
	*capturedClient
	entered chan struct{}
}

func (b blockedHead) Get(ctx context.Context, path, kind string) (domain.RawRecord, error) {
	if path == "/eth/v1/beacon/headers/head" {
		close(b.entered)
		<-ctx.Done()
		return domain.RawRecord{}, ctx.Err()
	}
	return b.capturedClient.Get(ctx, path, kind)
}
func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("startup condition timed out")
}
func TestVerifiedStreamStartsWhilePollIsBlocked(t *testing.T) {
	engine := testEngine(t)
	client := &capturedClient{}
	beacon := blockedHead{client, make(chan struct{})}
	collector := &ingest.Collector{Beacon: beacon, Execution: client, Network: "sepolia", ChainID: "11155111", GenesisRoot: "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078"}
	snapshot, err := collector.Fetch(context.Background(), capturedSlot)
	if err != nil {
		t.Fatal(err)
	}
	if err := RecordSnapshot(context.Background(), engine, snapshot.Observation, "fixture", "live"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "event: block\ndata: {\"slot\":\"1\",\"block\":\"%s\"}\n\n", capturedRoot)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	poll := &Poller{Engine: engine, Collector: collector, Repository: &storage.Postgres{Pool: engine.Pool}, Beacon: beacon, Network: "sepolia", SourceID: "fixture", Interval: time.Hour, Lookback: 1, MaxCatchup: 2}
	pollDone := make(chan struct{})
	go func() { defer close(pollDone); poll.Run(ctx) }()
	select {
	case <-beacon.entered:
	case <-time.After(time.Second):
		t.Fatal("poll did not enter blocked history read")
	}
	stream := &Stream{Engine: engine, URL: server.URL, Network: "sepolia", SourceID: "fixture", VerifyNetwork: collector.VerifyNetwork}
	streamDone := make(chan struct{})
	go func() { defer close(streamDone); stream.Run(ctx) }()
	waitFor(t, func() bool {
		p, err := engine.Progress(context.Background(), "sepolia", "fixture")
		return err == nil && p.StreamStatus == "connected"
	})
	select {
	case <-pollDone:
		t.Fatal("poll unexpectedly finished")
	default:
	}
	cancel()
	select {
	case <-streamDone:
	case <-time.After(time.Second):
		t.Fatal("stream did not stop")
	}
	select {
	case <-pollDone:
	case <-time.After(time.Second):
		t.Fatal("poll did not stop")
	}
	states, err := engine.States(context.Background(), "sepolia", "live", "fixture", nil, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, s := range states {
		if s.Slot == capturedSlot {
			found = true
			if s.RevealLatencyMS != nil {
				t.Fatal("unknown timing of a polled slot was invented")
			}
		}
	}
	if !found {
		t.Fatal("polled observation disappeared")
	}
}
func TestStreamNetworkMismatchCannotSubscribe(t *testing.T) {
	engine := testEngine(t)
	client := &capturedClient{}
	collector := &ingest.Collector{Beacon: client, Execution: client, ChainID: "11155111", GenesisRoot: capturedRoot}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); w.WriteHeader(501) }))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := &Stream{Engine: engine, URL: server.URL, Network: "sepolia", SourceID: "fixture", VerifyNetwork: collector.VerifyNetwork}
	done := make(chan struct{})
	go func() { defer close(done); stream.Run(ctx) }()
	waitFor(t, func() bool {
		p, err := engine.Progress(context.Background(), "sepolia", "fixture")
		return err == nil && p.StreamStatus == "network_verification_failed"
	})
	if requests.Load() != 0 {
		t.Fatal("unverified endpoint was subscribed")
	}
	cancel()
	<-done
}

// Explicit opt-in: subscribes briefly to configured live nodes, writing only to
// the isolated test schema created by testEngine. It never starts an API server.
func TestLiveVerifiedStreamStartup(t *testing.T) {
	if os.Getenv("ROOTED_TEST_LIVE_STREAM") != "1" {
		t.Skip("set ROOTED_TEST_LIVE_STREAM=1 for the configured live-node smoke test")
	}
	engine := testEngine(t)
	c, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	collector := &ingest.Collector{Beacon: remote.New(c.BeaconURL, c.RequestTimeout), Execution: remote.New(c.ExecutionURL, c.RequestTimeout), Network: c.Network, ChainID: c.ChainID, GenesisRoot: c.GenesisRoot}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	done := make(chan struct{})
	stream := &Stream{Engine: engine, URL: c.BeaconURL, Network: c.Network, SourceID: "startup-live-test", VerifyNetwork: collector.VerifyNetwork}
	go func() { defer close(done); stream.Run(ctx) }()
	defer func() { cancel(); <-done }()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		progress, err := engine.Progress(ctx, c.Network, "startup-live-test")
		if err == nil && progress.StreamStatus == "connected" {
			var events int
			if err := engine.Pool.QueryRow(ctx, "SELECT count(*) FROM pw_events").Scan(&events); err != nil {
				t.Fatal(err)
			}
			if events > 0 {
				t.Logf("verified live SSE subscription connected and persisted %d events in isolated test schema", events)
				return
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("verified live SSE traffic did not arrive within the smoke-test budget")
		case <-ticker.C:
		}
	}
}
