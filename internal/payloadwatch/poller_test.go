package payloadwatch

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"rooted/internal/domain"
	"rooted/internal/ingest"
	"rooted/internal/remote"
	"rooted/internal/storage"
	"strconv"
	"testing"
	"time"
)

// The slot and root come from the ingest fixtures, so a recapture needs no edit here.
var capturedSlot, capturedRoot = capturedIdentity()

func capturedIdentity() (uint64, string) {
	var block, envelope struct {
		Data struct {
			Message struct {
				Slot string `json:"slot"`
				Root string `json:"beacon_block_root"`
			} `json:"message"`
		} `json:"data"`
	}
	b, _ := captured("beacon_block")
	e, _ := captured("matched_envelope")
	_ = json.Unmarshal(b.Body, &block)
	_ = json.Unmarshal(e.Body, &envelope)
	slot, _ := strconv.ParseUint(block.Data.Message.Slot, 10, 64)
	return slot, envelope.Data.Message.Root
}

type capturedClient struct {
	head    uint64
	headers []string
	fail    bool
}

func captured(t string) (domain.RawRecord, error) {
	raw, err := os.ReadFile(filepath.Join("..", "ingest", "testdata", t+".json"))
	if err != nil {
		return domain.RawRecord{}, err
	}
	var record struct {
		Body string `json:"body"`
	}
	err = json.Unmarshal(raw, &record)
	return domain.RawRecord{Source: domain.Source{Kind: t, Origin: "https://fixture.invalid", FetchedAt: time.Now().UTC()}, Body: json.RawMessage(record.Body)}, err
}
func (c *capturedClient) Get(ctx context.Context, path, kind string) (domain.RawRecord, error) {
	if c.fail {
		return domain.RawRecord{}, remote.ErrNotFound
	}
	body := func(v any) (domain.RawRecord, error) {
		b, e := json.Marshal(v)
		return domain.RawRecord{Source: domain.Source{Kind: kind, FetchedAt: time.Now().UTC()}, Body: b}, e
	}
	switch path {
	case "/eth/v1/beacon/genesis":
		return captured("beacon_genesis")
	case "/eth/v1/beacon/headers/" + fmtSlot(capturedSlot):
		c.headers = append(c.headers, path)
		return body(map[string]any{"data": map[string]any{"root": capturedRoot, "canonical": true, "header": map[string]any{"message": map[string]string{"slot": fmtSlot(capturedSlot)}}}})
	case "/eth/v2/beacon/blocks/" + capturedRoot:
		return captured("beacon_block")
	case "/eth/v1/beacon/execution_payload_envelopes/" + capturedRoot:
		return captured("matched_envelope")
	default:
		if len(path) > 22 {
			c.headers = append(c.headers, path)
		}
		return domain.RawRecord{}, remote.ErrNotFound
	}
}
func (c *capturedClient) RPC(ctx context.Context, method string, params []any) (domain.RawRecord, error) {
	if method == "eth_chainId" {
		return domain.RawRecord{Body: json.RawMessage(`{"result":"0xaa36a7"}`)}, nil
	}
	return captured("matched_execution_block")
}

type headClient struct{ *capturedClient }

func (c headClient) Get(ctx context.Context, path, kind string) (domain.RawRecord, error) {
	if path == "/eth/v1/beacon/headers/head" {
		b, _ := json.Marshal(map[string]any{"data": map[string]any{"header": map[string]any{"message": map[string]any{"slot": fmtSlot(c.head)}}}})
		return domain.RawRecord{Body: b}, nil
	}
	return c.capturedClient.Get(ctx, path, kind)
}
func fmtSlot(s uint64) string { return strconv.FormatUint(s, 10) }
func TestPollingCheckpointRecovery(t *testing.T) {
	engine := testEngine(t)
	if capturedSlot == 0 || capturedRoot == "" {
		t.Fatal("ingest fixtures lack a block slot or envelope beacon_block_root")
	}
	ctx := context.Background()
	client := &capturedClient{head: capturedSlot}
	beacon := headClient{client}
	collector := &ingest.Collector{Beacon: beacon, Execution: client, Network: "sepolia", ChainID: "11155111", GenesisRoot: "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078"}
	p := Poller{Engine: engine, Collector: collector, Repository: &storage.Postgres{Pool: engine.Pool}, Beacon: beacon, Network: "sepolia", SourceID: "fixture", Lookback: 1, MaxCatchup: 2}
	if err := p.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	progress, err := engine.Progress(ctx, "sepolia", "fixture")
	if err != nil || progress.LastSlot == nil || *progress.LastSlot != fmtSlot(capturedSlot) {
		t.Fatalf("checkpoint failed %+v %v", progress, err)
	}
	states, err := engine.States(ctx, "sepolia", "live", "fixture", nil, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range states {
		if s.Slot == capturedSlot && (s.RevealLatencyMS != nil || s.Status == "healthy" || !s.IdentifiersMatched) {
			t.Fatalf("poll invented timing or lost correlation %+v", s)
		}
	}
	// Simulated restart, with the chain advancing beyond a bounded catchup pass.
	client.head += 5
	restarted := p
	restarted.Engine = &Engine{Pool: engine.Pool, Policy: testPolicy}
	if err = restarted.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	progress, err = engine.Progress(ctx, "sepolia", "fixture")
	if err != nil || *progress.LastSlot != fmtSlot(capturedSlot+2) {
		t.Fatalf("checkpoint jumped across unvisited gap %+v %v", progress, err)
	}
	if err = restarted.Poll(ctx); err != nil {
		t.Fatal(err)
	}
	progress, _ = engine.Progress(ctx, "sepolia", "fixture")
	if *progress.LastSlot != fmtSlot(capturedSlot+5) {
		t.Fatalf("did not catch up %+v", progress)
	}
	alerts, err := engine.Alerts(ctx, "sepolia", "live", "fixture", 50)
	if err != nil || len(alerts) != 0 {
		t.Fatalf("404 blamed on builder %+v %v", alerts, err)
	}
}
