package payloadwatch

import (
	"encoding/json"
	"io"
	"reflect"
	"rooted/internal/domain"
	"strings"
	"testing"
	"time"
)

var testAt = time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
var testPolicy = Policy{LateAfter: 2 * time.Second, MissingAfter: 8 * time.Second, PTCQuorum: 6, PTCSize: 8}

func evidence(slot uint64, kind string, delta time.Duration) Event {
	return Event{Network: "sepolia", Mode: "synthetic", SourceID: "test", Slot: slot, Root: "0x" + strings.Repeat("a", 64), PayloadHash: "0x" + strings.Repeat("b", 64), Builder: "7", Kind: kind, ObservedAt: testAt.Add(delta), Session: "s", Timed: true}
}
func selected(slot uint64, retrieved bool) Event {
	e := evidence(slot, "snapshot", 0)
	e.Snapshot = &domain.Observation{Network: e.Network, Slot: slot, BlockRoot: e.Root, PayloadHash: e.PayloadHash, BuilderIndex: e.Builder, CanonicalAtFetch: true, PayloadRetrieved: retrieved, IdentifiersMatched: retrieved, IncludedPTCAttestations: json.RawMessage(`[]`)}
	return e
}
func healthyEvidence() []Event {
	p := evidence(1, "ptc", time.Second)
	p.Votes = &Votes{Bits: "0xff", PayloadPresent: true, BlobAvailable: true}
	v := evidence(1, "validation", time.Second)
	v.Valid = boolPtr(true)
	return []Event{selected(1, false), evidence(1, "block_seen", 0), evidence(1, "payload_seen", time.Second), v, p}
}
func TestReduceEvidence(t *testing.T) {
	session := []Session{{ID: "s", Start: testAt, Through: testAt.Add(10 * time.Second)}}
	tests := []struct {
		name             string
		events           []Event
		sessions         []Session
		status, delivery string
		latency          bool
	}{
		{"healthy", healthyEvidence(), session, "healthy", "revealed", true},
		{"polling cannot time", []Event{selected(1, true)}, nil, "pending", "revealed", false},
		{"missing with coverage", []Event{selected(1, false), evidence(1, "block_seen", 0)}, session, "warning", "missing", false},
		{"outage stays unknown", []Event{selected(1, false), evidence(1, "block_seen", 0)}, []Session{{ID: "s", Start: testAt, Through: testAt.Add(time.Second), Closed: true}}, "pending", "pending", false},
		{"socket alone insufficient", []Event{selected(1, false), evidence(1, "block_seen", 0)}, []Session{{ID: "s", Start: testAt, Through: testAt}}, "pending", "pending", false},
		{"late local receipt", []Event{selected(1, false), evidence(1, "block_seen", 0), evidence(1, "payload_seen", 3*time.Second)}, session, "warning", "late", true},
		{"no coverage record", healthyEvidence(), nil, "healthy", "revealed", false},
		{"negative delta", []Event{selected(1, false), evidence(1, "block_seen", time.Second), evidence(1, "payload_seen", 0)}, session, "pending", "revealed", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := Reduce(tt.events, tt.sessions, testPolicy, testAt.Add(20*time.Second))
			if s.Status != tt.status || s.Delivery != tt.delivery || (s.RevealLatencyMS != nil) != tt.latency {
				t.Fatalf("unexpected %+v", s)
			}
		})
	}
}
func TestPTCUnionAndConflicts(t *testing.T) {
	events := []Event{selected(1, true)}
	for i, bits := range []string{"0x0f", "0x3c", "0x0f"} {
		e := evidence(1, "ptc", time.Duration(i)*time.Second)
		e.Votes = &Votes{Bits: bits, PayloadPresent: true, BlobAvailable: true}
		events = append(events, e)
	}
	s := Reduce(events, nil, testPolicy, testAt)
	if s.PTCPayloadYes != 6 || s.PTCTimely == nil || !*s.PTCTimely {
		t.Fatalf("overlapping aggregates double counted: %+v", s)
	}
	e := evidence(1, "ptc", 4*time.Second)
	e.Votes = &Votes{Bits: "0x01", PayloadPresent: false, BlobAvailable: false}
	events = append(events, e)
	s = Reduce(events, nil, testPolicy, testAt)
	if s.PTCPayloadYes != 5 || s.PTCConflictingParticipants != 1 || s.PTCTimely != nil {
		t.Fatalf("equivocation not excluded: %+v", s)
	}
	e.Votes = &Votes{ValidatorIndex: "99", PayloadPresent: true, BlobAvailable: true}
	s = Reduce([]Event{e}, nil, testPolicy, testAt)
	if s.PTCPayloadYes != 0 {
		t.Fatal("individual index counted as committee bit")
	}
}
func TestMismatchInvalidOrderingAndSessions(t *testing.T) {
	session := []Session{{ID: "s", Start: testAt, Through: testAt.Add(10 * time.Second)}}
	events := healthyEvidence()
	base := Reduce(events, session, testPolicy, testAt)
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}
	if got := Reduce(events, session, testPolicy, testAt); !reflect.DeepEqual(got, base) {
		t.Fatal("projection depends on input order")
	}
	e := evidence(1, "validation", 2*time.Second)
	e.Valid = boolPtr(false)
	s := Reduce(append(events, e), session, testPolicy, testAt)
	if s.Status != "failed" || s.ExecutionValid == nil || *s.ExecutionValid {
		t.Fatal("invalid evidence hidden")
	}
	e = evidence(1, "payload_seen", 2*time.Second)
	e.PayloadHash = "0x" + strings.Repeat("c", 64)
	if Reduce(append(events, e), session, testPolicy, testAt).Status != "failed" {
		t.Fatal("mismatch hidden")
	}
	e = evidence(1, "payload_seen", time.Second)
	e.Session = "other"
	s = Reduce([]Event{selected(1, false), evidence(1, "block_seen", 0), e}, session, testPolicy, testAt)
	if s.RevealLatencyMS != nil {
		t.Fatal("timing crosses reconnect")
	}
}
func TestReadSSE(t *testing.T) {
	var kinds []string
	var data []string
	activity := 0
	err := ReadSSE(strings.NewReader(": heartbeat\r\nevent: block\r\ndata: {\"slot\":\"1\",\r\ndata: \"ok\":true}\r\n\r\nevent: incomplete\ndata: ignored"), func() error { activity++; return nil }, func(kind string, raw []byte) error {
		kinds = append(kinds, kind)
		data = append(data, string(raw))
		return nil
	})
	if err != io.EOF || activity == 0 || len(kinds) != 1 || kinds[0] != "block" || !json.Valid([]byte(data[0])) {
		t.Fatalf("SSE parse failed: %v %v %v", err, kinds, data)
	}
}
func TestDecodeStream(t *testing.T) {
	raw := `{"slot":"1","block_root":"0x` + strings.Repeat("a", 64) + `","block_hash":"0x` + strings.Repeat("b", 64) + `","builder_index":"7","execution_optimistic":false}`
	e, _, err := DecodeEvent("execution_payload", []byte(raw), "sepolia", "source", "s", testAt)
	if err != nil || e.Valid == nil || !*e.Valid || e.Kind != "validation" {
		t.Fatalf("%+v %v", e, err)
	}
	e, slot, err := DecodeEvent("execution_payload_available", []byte(raw), "sepolia", "source", "s", testAt)
	if err != nil || e != nil || slot == nil {
		t.Fatal("availability event treated as envelope or quorum")
	}
}
