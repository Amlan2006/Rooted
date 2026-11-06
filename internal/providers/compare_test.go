package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"rooted/internal/bal"
	"strings"
	"testing"
	"time"
)

func hash(c string) string { return "0x" + strings.Repeat(c, 64) }

type fixtureTransport struct{ handler http.Handler }

func (f fixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := r.Context().Err(); err != nil {
		return nil, err
	}
	w := httptest.NewRecorder()
	f.handler.ServeHTTP(w, r)
	return w.Result(), nil
}

func fixture(t *testing.T, mode string) (*Collector, func()) {
	t.Helper()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		right := strings.HasPrefix(r.URL.Path, "/right")
		w.Header().Set("Content-Type", "application/json")
		send := func(value any) {
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": value})
		}
		if strings.HasSuffix(r.URL.Path, "/eth/v1/beacon/genesis") {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"genesis_validators_root": hash("c")}})
			return
		}
		if strings.Contains(r.URL.Path, "execution_payload_envelopes") {
			h := hash("a")
			if right && mode == "envelope_identity" {
				h = hash("b")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"message": map[string]any{"payload": map[string]string{"block_hash": h, "block_number": "2", "slot_number": "3", "block_access_list": "0xc0"}}}})
			return
		}
		var q struct {
			Method string            `json:"method"`
			Params []json.RawMessage `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&q)
		switch q.Method {
		case "eth_chainId":
			if right && mode == "network" {
				send("0x1")
			} else {
				send("0xaa36a7")
			}
		case "eth_getBlockByNumber":
			send(Header{Hash: hash("d"), Number: "0x1"})
		case "eth_getBlockByHash":
			if right && mode == "missing" {
				send(nil)
				return
			}
			if right && mode == "http404" {
				w.WriteHeader(404)
				return
			}
			if right && mode == "http" {
				w.WriteHeader(429)
				_, _ = w.Write([]byte("secret endpoint details"))
				return
			}
			if right && mode == "malformed" {
				send(map[string]any{"hash": hash("a"), "stateRoot": 17})
				return
			}
			h := Header{Hash: hash("a"), Number: "0x2", Parent: hash("d"), State: hash("e"), TransactionsRoot: hash("f"), ReceiptsRoot: hash("f"), BALHash: bal.Keccak([]byte{0xc0}), Slot: "0x3", Timestamp: "0x4", Transactions: []string{}}
			if right && mode == "commitment" {
				h.BALHash = hash("b")
			}
			if right && mode == "header" {
				h.State = hash("b")
			}
			if right && mode == "identity" {
				h.Hash = hash("b")
			}
			send(h)
		case "eth_getBlockAccessList":
			if right && mode == "unsupported" {
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32601, "message": "secret URL https://user:password@private.test"}})
				return
			}
			if right && mode == "pruned" {
				_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": -32000, "message": "history pruned secret"}})
				return
			}
			if right && mode == "bad_bal" {
				send(map[string]any{"invalid": "payload"})
				return
			}
			send([]any{})
		}
	})
	c := &Collector{Providers: [2]Endpoint{{"primary", "http://fixture.invalid/left", "http://fixture.invalid/left"}, {"reference", "http://fixture.invalid/right", "http://fixture.invalid/right"}}, AnchorNumber: "0x1", AnchorHash: hash("d"), GenesisRoot: hash("c"), Timeout: time.Second, Transport: fixtureTransport{handler}}
	return c, func() {}
}
func TestSameImmutableBlockAndVerifiedBAL(t *testing.T) {
	c, close := fixture(t, "")
	defer close()
	r, err := c.Compare(context.Background(), hash("a"))
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != "consistent_observed_data" {
		t.Fatalf("%s %+v", r.Status, r.Findings)
	}
	for _, o := range r.Observations {
		if !o.NetworkVerified || len(o.Checks) != 6 {
			t.Fatal(o)
		}
		for _, check := range o.Checks {
			if check.Status != "available" || check.Digest == "" {
				t.Fatal(check)
			}
		}
	}
	next, err := c.Compare(context.Background(), hash("a"))
	if err != nil || next.ID == r.ID {
		t.Fatal("recheck must create a new observation")
	}
}
func TestCapabilityMissingHistoryAndContradictionsAreDistinct(t *testing.T) {
	for mode, want := range map[string]string{"unsupported": "matching_block_with_observation_gaps", "pruned": "matching_block_with_observation_gaps", "missing": "incomplete_observations", "http": "incomplete_observations", "http404": "incomplete_observations", "commitment": "disagreement_requires_investigation", "network": "incomplete_observations", "malformed": "incomplete_observations", "header": "disagreement_requires_investigation", "identity": "disagreement_requires_investigation", "envelope_identity": "disagreement_requires_investigation", "bad_bal": "disagreement_requires_investigation"} {
		t.Run(mode, func(t *testing.T) {
			c, close := fixture(t, mode)
			defer close()
			r, err := c.Compare(context.Background(), hash("a"))
			if err != nil {
				t.Fatal(err)
			}
			if r.Status != want {
				t.Fatalf("%s: %+v", r.Status, r.Findings)
			}
			encoded, _ := json.Marshal(r)
			if strings.Contains(string(encoded), "password") || strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "private.test") {
				t.Fatal("upstream diagnostic leaked")
			}
			if mode == "network" && len(r.Observations[1].Checks) != 2 {
				t.Fatal("network mismatch must stop further probes")
			}
		})
	}
}
func TestUnknownsAndIdenticalSourcesCannotClaimIndependentAgreement(t *testing.T) {
	c, close := fixture(t, "")
	defer close()
	c.Providers[1] = c.Providers[0]
	r, _ := c.Compare(context.Background(), hash("a"))
	if r.Status != "matching_block_with_observation_gaps" {
		t.Fatal(r.Status)
	}
	if _, err := c.Compare(context.Background(), "latest"); err == nil {
		t.Fatal("moving target accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, _ = c.Compare(ctx, hash("a"))
	if r.Status != "incomplete_observations" {
		t.Fatal(r.Status)
	}
}
func TestFingerprintsDoNotExposeOrDependOnCredentials(t *testing.T) {
	a := sourceID("https://user:password@example.test/rpc?token=secret")
	if a != sourceID("https://example.test/rpc?token=rotated") || strings.Contains(a, "secret") {
		t.Fatal(a)
	}
}
