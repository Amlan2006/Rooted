package payloadwatch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"rooted/internal/domain"
)

func TestSyntheticScenariosWithoutDatabase(t *testing.T) {
	path := os.Getenv("ROOTED_TEST_DATASET")
	if path == "" {
		path = "testdata/synthetic.json"
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	dataset, err := DecodeDataset(file, "sepolia")
	if err != nil {
		t.Fatal(err)
	}
	policy := Policy{LateAfter: time.Duration(dataset.Policy.LateMS) * time.Millisecond, MissingAfter: time.Duration(dataset.Policy.MissingMS) * time.Millisecond, PTCSize: dataset.Policy.Size, PTCQuorum: dataset.Policy.Quorum}
	groups := map[uint64][]Event{}
	seen := map[string]bool{}
	duplicates := 0
	for _, event := range dataset.Events {
		id := EventID(event)
		if seen[id] {
			duplicates++
			continue
		}
		seen[id] = true
		groups[event.Slot] = append(groups[event.Slot], event)
	}
	expected := map[uint64][2]string{101: {"healthy", "revealed"}, 102: {"warning", "late"}, 103: {"warning", "missing"}, 104: {"failed", "missing"}, 105: {"failed", "revealed"}, 106: {"pending", "pending"}, 107: {"warning", "revealed"}}
	if len(groups) != 7 || len(seen) != 23 || duplicates != 1 {
		t.Fatalf("wrong fixture counts: groups=%d events=%d duplicates=%d", len(groups), len(seen), duplicates)
	}
	timed := 0
	var projected []State
	for slot, events := range groups {
		state := Reduce(events, dataset.Sessions, policy, dataset.Sessions[0].Through)
		projected = append(projected, state)
		if state.Status != expected[slot][0] || state.Delivery != expected[slot][1] {
			t.Fatalf("slot %d: %+v", slot, state)
		}
		if state.RevealLatencyMS != nil {
			timed++
		}
		if slot == 101 && (state.RevealLatencyMS == nil || *state.RevealLatencyMS != 1000) {
			t.Fatal("healthy receipt timing lost")
		}
		if slot == 106 && (state.RevealLatencyMS != nil || state.ExecutionValid != nil || len(state.Alerts) != 0) {
			t.Fatal("outage was turned into a builder failure or fabricated timing")
		}
	}
	if timed != 4 {
		t.Fatalf("expected four comparable timing samples, got %d", timed)
	}
	sort.Slice(projected, func(i, j int) bool { return projected[i].Slot < projected[j].Slot })
	encoded, err := json.Marshal(map[string]any{"schema": "rooted.phase3-offline-evidence-v1", "mode": "synthetic", "verification": "offline_reducer_only", "persistence_verified": false, "unique_events": len(seen), "duplicates": duplicates, "timed_samples": timed, "states": projected})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("ROOTED_PHASE3_OFFLINE_EVIDENCE=%s", encoded)
}

func TestReplayRejectsInvalidInputsBeforeDatabase(t *testing.T) {
	base := Dataset{Network: "sepolia", Mode: "synthetic", SourceID: "test", Events: healthyEvidence()}
	for _, tc := range []struct {
		name   string
		change func(*Dataset)
	}{
		{"live mode", func(d *Dataset) { d.Mode = "live" }},
		{"wrong network", func(d *Dataset) { d.Network = "other" }},
		{"missing source", func(d *Dataset) { d.SourceID = "" }},
		{"mixed source", func(d *Dataset) { d.Events[0].SourceID = "other" }},
		{"mixed mode", func(d *Dataset) { d.Events[0].Mode = "live" }},
		{"synthetic quorum", func(d *Dataset) { d.Policy = &FixturePolicy{LateMS: 1, MissingMS: 2, Size: 8, Quorum: 9} }},
		{"fixture policy in replay", func(d *Dataset) {
			d.Mode = "replay"
			d.Policy = &FixturePolicy{LateMS: 1, MissingMS: 2, Size: 8, Quorum: 6}
		}},
		{"invalid session", func(d *Dataset) { d.Sessions = []Session{{ID: "s", Start: testAt, Through: testAt.Add(-time.Second)}} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := base
			d.Events = healthyEvidence()
			tc.change(&d)
			raw, _ := json.Marshal(d)
			if _, err := Replay(context.Background(), nil, bytes.NewReader(raw), "sepolia"); err == nil {
				t.Fatal("invalid replay reached database stage")
			}
		})
	}
	for _, raw := range []string{`{"unknown":1}`, `{} {}`, strings.Repeat(" ", (32<<20)+1)} {
		if _, err := DecodeDataset(strings.NewReader(raw), "sepolia"); err == nil {
			t.Fatal("invalid or oversized input accepted")
		}
	}
}

func TestEventIdentityDeduplicationAndNumericPrecision(t *testing.T) {
	one := evidence(1, "block_seen", 0)
	one.Raw = json.RawMessage(`{"n":18446744073709551615,"flag":true}`)
	two := one
	two.Raw = json.RawMessage(`{ "flag": true, "n": 18446744073709551615 }`)
	two.ObservedAt = two.ObservedAt.Add(time.Hour)
	two.Session = "reconnected"
	if EventID(one) != EventID(two) {
		t.Fatal("duplicate or formatting changed event identity")
	}
	two.Raw = json.RawMessage(`{"n":18446744073709551614,"flag":true}`)
	if EventID(one) == EventID(two) {
		t.Fatal("large JSON integers were rounded during deduplication")
	}
	two = one
	two.SourceID = "other"
	if EventID(one) == EventID(two) {
		t.Fatal("sources share evidence identity")
	}
	two = one
	two.Mode = "replay"
	if EventID(one) == EventID(two) {
		t.Fatal("modes share evidence identity")
	}
	first := selected(1, true)
	second := first
	copy := *first.Snapshot
	copy.FetchedAt = testAt.Add(time.Hour)
	copy.Sources = []domain.Source{{Kind: "example", Origin: "https://fixture.invalid"}}
	second.Snapshot = &copy
	if EventID(first) != EventID(second) {
		t.Fatal("fetch metadata created a new semantic snapshot")
	}
}

func TestDefaultQuorumNeverInventsHealthyVerdict(t *testing.T) {
	policy := testPolicy
	policy.PTCQuorum = 0
	state := Reduce(healthyEvidence(), []Session{{ID: "s", Start: testAt, Through: testAt.Add(10 * time.Second)}}, policy, testAt.Add(10*time.Second))
	if state.PTCTimely != nil || state.BlobAvailable != nil || state.Status == "healthy" {
		t.Fatalf("disabled quorum produced a verdict: %+v", state)
	}
}

func TestSSERejectsOversizedFramesAndStopsOnHandlerError(t *testing.T) {
	err := ReadSSE(strings.NewReader("data: "+strings.Repeat("x", (1<<20)+1)), func() error { return nil }, func(string, []byte) error { return nil })
	if err == nil || err == io.EOF {
		t.Fatal("oversized SSE line accepted")
	}
	wanted := errors.New("handler failed")
	err = ReadSSE(strings.NewReader("event: block\ndata: {}\n\n"), func() error { return nil }, func(string, []byte) error { return wanted })
	if !errors.Is(err, wanted) {
		t.Fatalf("handler error lost: %v", err)
	}
}

type offlineTransport func(*http.Request) (*http.Response, error)

func (f offlineTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestStreamUnavailableAndWrongContentWithoutSocket(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		content string
	}{
		{"unsupported", 501, "text/plain"},
		{"not SSE", 200, "application/json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: offlineTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Query().Get("topics") == "" || r.Header.Get("Accept") != "text/event-stream" {
					t.Fatal("missing subscription parameters")
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": []string{tc.content}}, Body: io.NopCloser(strings.NewReader(""))}, nil
			})}
			stream := Stream{URL: "http://fixture.invalid", HTTPClient: client}
			if err := stream.once(context.Background()); err == nil {
				t.Fatal("unavailable or non-SSE endpoint accepted")
			}
		})
	}
}

func TestStreamRequiresIndependentBoundedVerification(t *testing.T) {
	stream := Stream{}
	if err := stream.verifyNetwork(context.Background()); err == nil {
		t.Fatal("missing verifier accepted")
	}
	wanted := errors.New("wrong network")
	stream.VerifyNetwork = func(ctx context.Context) error {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 30*time.Second {
			t.Fatal("verification deadline missing")
		}
		return wanted
	}
	if err := stream.verifyNetwork(context.Background()); !errors.Is(err, wanted) {
		t.Fatalf("network mismatch lost: %v", err)
	}
}
