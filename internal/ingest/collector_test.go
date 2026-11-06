package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"rooted/internal/remote"
)

const testSlot uint64 = 11518268
const testRoot = "0x0954ea392e2243b52da3ef76bc27b1479db7dcbbd495af6d5b0f1006904f367b"
const genesisRoot = "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078"

// Responses captured 2026-11-06 from local Sepolia Nimbus/Geth for self-built
// slot 11518268 (EL block 12075314) exercise the actual client schema, including
// slot_number and PTC aggregates referring to the preceding slot.
func recorded(t *testing.T, name string) json.RawMessage {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var record struct {
		Body string `json:"body"`
	}
	if err = json.Unmarshal(data, &record); err != nil {
		t.Fatal(err)
	}
	return json.RawMessage(record.Body)
}

type fixture struct {
	headerStatus   int
	envelopeStatus int
	block          blockResponse
	envelope       envelopeResponse
	execution      json.RawMessage
	chain          string
	genesis        json.RawMessage
}

func setup(t *testing.T, change func(*fixture)) *Collector {
	t.Helper()
	f := fixture{headerStatus: 200, envelopeStatus: 200, execution: recorded(t, "matched_execution_block"), chain: "0xaa36a7"}
	genesisBody := recorded(t, "beacon_genesis")
	f.genesis = genesisBody
	if err := json.Unmarshal(recorded(t, "beacon_block"), &f.block); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(recorded(t, "matched_envelope"), &f.envelope); err != nil {
		t.Fatal(err)
	}
	if change != nil {
		change(&f)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/eth/v1/beacon/genesis":
			_, _ = w.Write(f.genesis)
		case "/eth/v1/beacon/headers/11518268":
			w.WriteHeader(f.headerStatus)
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"root": testRoot, "canonical": true, "header": map[string]any{"message": map[string]string{"slot": "11518268"}}}})
		case "/eth/v2/beacon/blocks/" + testRoot:
			_ = json.NewEncoder(w).Encode(f.block)
		case "/eth/v1/beacon/execution_payload_envelopes/" + testRoot:
			w.WriteHeader(f.envelopeStatus)
			_ = json.NewEncoder(w).Encode(f.envelope)
		case "/", "":
			var req struct {
				Method string `json:"method"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req.Method == "eth_chainId" {
				_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": f.chain})
			} else {
				_, _ = w.Write(f.execution)
			}
		default:
			t.Errorf("unexpected mutable/unrecognized path %s", r.URL.Path)
			w.WriteHeader(500)
		}
	})
	client := remote.NewWithHTTPClient("http://recorded.invalid", &http.Client{Transport: fixtureTransport{handler}, Timeout: time.Second})
	return &Collector{Beacon: client, Execution: client, Network: "sepolia", ChainID: "11155111", GenesisRoot: genesisRoot}
}

// Exercise the HTTP client against captured responses without opening sockets.
type fixtureTransport struct{ handler http.Handler }

func (f fixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := r.Context().Err(); err != nil {
		return nil, err
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w.Result(), nil
}

func TestCapturedSlotCorrelation(t *testing.T) {
	c := setup(t, nil)
	snapshot, err := c.Fetch(context.Background(), testSlot)
	if err != nil {
		t.Fatal(err)
	}
	o := snapshot.Observation
	if o.BlockRoot != testRoot || !o.IdentifiersMatched || o.Status != "observed" || !o.SelfBuild {
		t.Fatalf("unexpected result: %+v", o)
	}
	if o.RevealLatencyMS != nil || o.CommitmentSeenAt != nil || o.PayloadSeenAt != nil || o.PTCTimely != nil || o.BlobAvailable != nil || o.ExecutionValid != nil {
		t.Fatal("offline fetch fabricated live health/timing")
	}
	if !strings.Contains(string(o.IncludedPTCAttestations), "11518267") {
		t.Fatal("prior-slot PTC evidence was lost")
	}
	if len(snapshot.Records) != 6 || len(o.Sources) != 6 {
		t.Fatalf("missing provenance: %d", len(snapshot.Records))
	}
}
func TestRejectIdentifierMismatch(t *testing.T) {
	cases := map[string]func(*fixture){
		"wrong network": func(f *fixture) { f.chain = "0x1" },
		"wrong genesis": func(f *fixture) {
			f.genesis = json.RawMessage(`{"data":{"genesis_validators_root":"0x` + strings.Repeat("1", 64) + `"}}`)
		},
		"wrong block slot":   func(f *fixture) { f.block.Data.Message.Slot = "11518267" },
		"wrong bid slot":     func(f *fixture) { f.block.Data.Message.Body.SignedBid.Message.Slot = "11518267" },
		"wrong payload hash": func(f *fixture) { f.envelope.Data.Message.Payload.Hash = "0x" + strings.Repeat("1", 64) },
		"wrong root":         func(f *fixture) { f.envelope.Data.Message.BlockRoot = "0x" + strings.Repeat("2", 64) },
		"wrong builder":      func(f *fixture) { f.envelope.Data.Message.BuilderIndex = "7" },
		"wrong state":        func(f *fixture) { f.envelope.Data.Message.Payload.StateRoot = "0x" + strings.Repeat("3", 64) },
		"wrong parent root":  func(f *fixture) { f.envelope.Data.Message.ParentRoot = "0x" + strings.Repeat("4", 64) },
		"wrong payload slot": func(f *fixture) { f.envelope.Data.Message.Payload.Slot = "11518267" },
		"wrong block number": func(f *fixture) { f.envelope.Data.Message.Payload.Number = "1" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := setup(t, change).Fetch(context.Background(), testSlot)
			if !errors.Is(err, ErrMismatch) {
				t.Fatalf("wanted mismatch, got %v", err)
			}
		})
	}
}
func TestMissingDataRemainsPending(t *testing.T) {
	c := setup(t, func(f *fixture) {
		f.envelopeStatus = 404
		f.execution = json.RawMessage(`{"jsonrpc":"2.0","id":1,"result":null}`)
	})
	s, err := c.Fetch(context.Background(), testSlot)
	if err != nil {
		t.Fatal(err)
	}
	if s.Observation.Status != "pending" || s.Observation.PayloadRetrieved || s.Observation.IdentifiersMatched || s.Observation.ExecutionBlockNumber != nil {
		t.Fatal("missing data was classified as success")
	}
}
func TestSkippedOrUnavailableSlot(t *testing.T) {
	_, err := setup(t, func(f *fixture) { f.headerStatus = 404 }).Fetch(context.Background(), testSlot)
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("wanted slot unavailable, got %v", err)
	}
}

func TestEnvelopeUpstreamFailureDoesNotBecomePending(t *testing.T) {
	_, err := setup(t, func(f *fixture) { f.envelopeStatus = 503 }).Fetch(context.Background(), testSlot)
	if err == nil || errors.Is(err, ErrUnavailable) {
		t.Fatalf("provider failure must fail ingestion, got %v", err)
	}
}

func TestUnsupportedCommitment(t *testing.T) {
	_, err := setup(t, func(f *fixture) { f.block.Data.Message.Body.SignedBid.Message.BlockHash = "" }).Fetch(context.Background(), testSlot)
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("expected unsupported block, got %v", err)
	}
}

func TestCanceledIngestion(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := setup(t, nil).Fetch(ctx, testSlot)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled ingestion, got %v", err)
	}
}
