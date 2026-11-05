package framemempool

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type offlineTransport func(*http.Request) (*http.Response, error)

func (f offlineTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestHTTPRPCErrorRedactionAndCancellation(t *testing.T) {
	client := NewClient("https://user:secret@fixture.invalid/key?token=secret", time.Second)
	client.HTTP.Transport = offlineTransport(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"secret endpoint diagnostics"}}`)), Header: http.Header{}}, nil
	})
	raw, err := client.Call(context.Background(), "eth_chainId", nil, nil)
	var rpcError *RPCError
	if !errors.As(err, &rpcError) || rpcError.Code != -32601 || strings.Contains(err.Error(), "secret") || len(raw.Body) == 0 {
		t.Fatalf("invalid RPC error handling: %v", err)
	}
	client.HTTP.Transport = offlineTransport(func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = client.Call(ctx, "eth_chainId", nil, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("lost cancellation: %v", err)
	}
}

func TestCanonicalEvidencePreservesIntegers(t *testing.T) {
	a, err := digest([]byte(`{"number":18446744073709551615,"ok":true}`))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := digest([]byte(`{ "ok": true, "number": 18446744073709551615 }`))
	c, _ := digest([]byte(`{"number":18446744073709551614,"ok":true}`))
	if a != b || a == c {
		t.Fatal("JSON formatting changed identity or distinct integers collapsed")
	}
	if _, err = canonical([]byte(`{} {}`)); err == nil {
		t.Fatal("accepted trailing JSON")
	}
}

func TestSubscriptionEnvelopes(t *testing.T) {
	if event, err := decodeSubscriptionEvent([]byte(" {} \n"), "sub"); err != nil || event != nil {
		t.Fatal("empty post-ack object became evidence")
	}
	good := `{"method":"skandha_subscription","params":{"subscription":"sub","result":{"seq":1,"txHash":"` + testHash + `","at":123,"kind":"admitted"}}}`
	event, err := decodeSubscriptionEvent([]byte(good), "sub")
	if err != nil || event == nil || event.Seq != 1 {
		t.Fatalf("valid event rejected: %+v %v", event, err)
	}
	for _, raw := range []string{strings.Replace(good, `"sub"`, `"other"`, 1), strings.Replace(good, `"seq":1`, `"seq":0`, 1), strings.Replace(good, `"admitted"`, `"unknown"`, 1), `{"method":`, `null`} {
		if _, err := decodeSubscriptionEvent([]byte(raw), "sub"); err == nil {
			t.Fatal("malformed or wrong-subscription event accepted")
		}
	}
}

func TestReceiptFailureStatesRemainDistinct(t *testing.T) {
	for _, tc := range []struct {
		name, headerHash, receiptType string
		missing, failedQuery          bool
		canonical                     *bool
	}{
		{"canonical", testHash, "0x6", false, false, truth(true)},
		{"reorg", "0x" + strings.Repeat("b", 64), "0x6", false, false, truth(false)},
		{"malformed header", "invalid", "0x6", false, false, nil},
		{"wrong transaction type", testHash, "0x2", false, false, nil},
		{"receipt absent", testHash, "0x6", true, false, nil},
		{"RPC failure", testHash, "0x6", false, true, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rpc := fakeRPC{call: func(method string, params []any, out any) (Raw, error) {
				switch method {
				case "eth_getTransactionReceipt":
					if tc.failedQuery {
						return Raw{}, errors.New("unavailable")
					}
					if tc.missing {
						return respond(method, nil, out)
					}
					return respond(method, Receipt{Hash: testHash, BlockHash: testHash, BlockNumber: "0x1", Status: "0x1", Type: tc.receiptType}, out)
				case "eth_getBlockByNumber":
					return respond(method, map[string]any{"hash": tc.headerHash, "number": "0x1"}, out)
				default:
					return Raw{}, errors.New("supplemental unavailable")
				}
			}}
			collector := Collector{Execution: rpc, Node: rpc}
			proof, _ := collector.receipt(context.Background(), testHash)
			if (proof.Canonical == nil) != (tc.canonical == nil) || (proof.Canonical != nil && *proof.Canonical != *tc.canonical) {
				t.Fatalf("incorrect canonical verdict: %+v", proof)
			}
			if tc.headerHash == "invalid" && proof.IdentityMatched {
				t.Fatal("malformed header established identity")
			}
		})
	}
}

func TestSubmissionValidationDoesNotReachNetwork(t *testing.T) {
	for _, tc := range []struct {
		scope Scope
		body  string
		hash  string
	}{
		{testScope, `{}`, testHash},
		{Scope{Network: "frame-devnet", Mode: "live", Node: "gateway"}, `{}`, testHash},
		{Scope{Network: "frame-devnet", Mode: "live", Node: "gateway"}, `{"chainId":"0x1","frames":[{}],"signatures":[{}]}`, testHash},
		{Scope{Network: "frame-devnet", Mode: "live", Node: "gateway"}, `{}`, "invalid"},
	} {
		collector := Collector{Scope: tc.scope, ChainID: 1337}
		if _, err := collector.Submit(context.Background(), json.RawMessage(tc.body), tc.hash); err == nil {
			t.Fatal("invalid submission reached verification/network")
		}
	}
}

func TestCapturedLifecycleEvidence(t *testing.T) {
	var states []State
	for _, name := range []string{"existing-included", "own-rejection"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "demo", "phase1", "reference", "frame-phase4", name+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var captured State
		if err = json.Unmarshal(raw, &captured); err != nil {
			t.Fatal(err)
		}
		captured.Scope.Mode = "captured"
		state := Reduce(captured.Scope, captured.Boot, captured.Hash, captured.Admission, captured.Events, captured.Proof, captured.FirstObservedAt, captured.UpdatedAt, 2*time.Minute)
		if state.Status != captured.Status || state.AdmissionConfirmed != captured.AdmissionConfirmed || state.InclusionConfirmed != captured.InclusionConfirmed {
			t.Fatalf("captured lifecycle changed: %+v", state)
		}
		states = append(states, state)
	}
	ack := Reduce(testScope, "synthetic-boot", testHash, nil, nil, nil, stamp, stamp, time.Minute)
	if ack.AdmissionConfirmed || ack.InclusionConfirmed || ack.Status != "unknown" {
		t.Fatal("acknowledgment alone became admission")
	}
	encoded, err := json.Marshal(map[string]any{"schema": "rooted.phase4-offline-evidence-v1", "verification": "offline_reducer_only", "persistence_verified": false, "canonicality_rechecked_now": false, "funded_own_submission_verified": false, "captured_states": states, "synthetic_acknowledgment_only": ack})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("ROOTED_PHASE4_OFFLINE_EVIDENCE=%s", encoded)
}
