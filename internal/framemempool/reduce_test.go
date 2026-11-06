package framemempool

import (
	"strings"
	"testing"
	"time"
)

var testHash = "0x" + strings.Repeat("a", 64)
var testScope = Scope{Network: "test-frame", Mode: "synthetic", Node: "gateway"}
var stamp = time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)

func TestLifecycleAndProof(t *testing.T) {
	a := Admission{ID: 1, Hash: testHash, At: stamp.UnixMilli(), Outcome: "accepted"}
	admitted := Event{Seq: 1, Hash: testHash, At: stamp.UnixMilli(), Kind: "admitted"}
	included := Event{Seq: 2, Hash: testHash, At: stamp.Add(time.Second).UnixMilli(), Kind: "included", Status: "OnChain"}
	good := Proof{CheckedAt: stamp, Receipt: &Receipt{Hash: testHash, Status: "0x1"}, IdentityMatched: true, Canonical: truth(true)}
	tests := []struct {
		name           string
		a              *Admission
		events         []Event
		p              *Proof
		status         string
		admit, include bool
		latency        bool
	}{
		{"acknowledgment alone", nil, nil, nil, "unknown", false, false, false},
		{"admission only", &a, []Event{admitted}, nil, "admitted", true, false, false},
		{"reported inclusion", &a, []Event{included, admitted}, nil, "included_reported", true, false, true},
		{"verified inclusion", &a, []Event{included, admitted}, &good, "included", true, true, true},
		{"receipt without admission", nil, nil, &good, "included", false, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := Reduce(testScope, "boot", testHash, tt.a, tt.events, tt.p, stamp, stamp.Add(2*time.Second), time.Minute)
			if s.Status != tt.status || s.AdmissionConfirmed != tt.admit || s.InclusionConfirmed != tt.include || (s.AdmissionToInclusionMS != nil) != tt.latency {
				t.Fatalf("unexpected %+v", s)
			}
		})
	}
	bad := good
	bad.Canonical = truth(false)
	s := Reduce(testScope, "boot", testHash, &a, []Event{included, admitted}, &bad, stamp, stamp, time.Minute)
	if s.Status != "reorged" || s.InclusionConfirmed {
		t.Fatalf("orphan claimed included %+v", s)
	}
	bad = good
	bad.IdentityMatched = false
	s = Reduce(testScope, "boot", testHash, &a, nil, &bad, stamp, stamp, time.Minute)
	if s.Status != "evidence_conflict" || s.InclusionConfirmed {
		t.Fatal("mismatched receipt accepted")
	}
	bad = good
	r := *good.Receipt
	r.Status = "0x0"
	bad.Receipt = &r
	s = Reduce(testScope, "boot", testHash, &a, nil, &bad, stamp, stamp, time.Minute)
	if s.Status != "reverted" || !s.InclusionConfirmed || *s.ExecutionSuccess {
		t.Fatal("reverted receipt mapping")
	}
}
func TestSnapshotsOrderingAndTimeout(t *testing.T) {
	a := Admission{ID: 1, Hash: testHash, At: stamp.Add(-24 * time.Hour).UnixMilli(), Outcome: "dropped", ObservedEventSeq: 2}
	events := []Event{{Seq: 1, Hash: testHash, At: 1, Kind: "admitted"}, {Seq: 2, Hash: testHash, At: 2, Kind: "dropped"}}
	s := Reduce(testScope, "boot", testHash, &a, events, nil, stamp, stamp, time.Minute)
	if s.Status != "dropped_reported" {
		t.Fatalf("snapshot overridden %+v", s)
	}
	a.Outcome = "accepted"
	s = Reduce(testScope, "boot", testHash, &a, events, nil, stamp, stamp, time.Minute)
	if s.Status != "admitted" {
		t.Fatalf("old drop overrides current admission %+v", s)
	}
	events = append(events, Event{Seq: 3, Hash: testHash, At: 3, Kind: "replaced"})
	s = Reduce(testScope, "boot", testHash, &a, events, nil, stamp, stamp, time.Minute)
	if s.Status != "replaced" {
		t.Fatal("new event ignored")
	}
	a.ObservedEventSeq = 0
	s = Reduce(testScope, "boot", testHash, &a, nil, nil, stamp, stamp.Add(2*time.Minute), time.Minute)
	if s.Status != "admitted" || !contains(s.Coverage, "inclusion_observation_window_elapsed") {
		t.Fatal("timeout became drop or did not expire")
	}
	s = Reduce(testScope, "boot", testHash, &a, nil, nil, stamp, stamp, time.Minute)
	if contains(s.Coverage, "inclusion_observation_window_elapsed") {
		t.Fatal("source clock used as local timeout")
	}
}
func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
