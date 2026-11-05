package payloadwatch

import (
	"encoding/hex"
	"sort"
	"strconv"
	"strings"
	"time"
)

func boolPtr(v bool) *bool { return &v }

// Reduce is deterministic over the evidence set, independent of insertion order.
// It never converts a historical fetch timestamp into an arrival-time measurement.
func Reduce(events []Event, sessions []Session, policy Policy, now time.Time) State {
	events = append([]Event(nil), events...)
	sort.Slice(events, func(i, j int) bool {
		if events[i].ObservedAt.Equal(events[j].ObservedAt) {
			return events[i].ID < events[j].ID
		}
		return events[i].ObservedAt.Before(events[j].ObservedAt)
	})
	s := State{Policy: FixturePolicy{LateMS: policy.LateAfter.Milliseconds(), MissingMS: policy.MissingAfter.Milliseconds(), Size: policy.PTCSize, Quorum: policy.PTCQuorum}, Status: "pending", Delivery: "unknown", Alerts: []string{}, Coverage: []string{}, EventCount: len(events), UpdatedAt: now}
	if len(events) == 0 {
		return s
	}
	s.Network = events[0].Network
	s.Mode = events[0].Mode
	s.SourceID = events[0].SourceID
	s.Slot = events[0].Slot
	s.Root = events[0].Root
	s.FirstObservedAt = events[0].ObservedAt
	selected := false
	for _, e := range events {
		if e.Kind == "snapshot" && e.Snapshot != nil {
			o := e.Snapshot
			if selected && s.PayloadHash != o.PayloadHash {
				s.Alerts = appendUnique(s.Alerts, "conflicting_commitment")
			}
			selected = true
			s.PayloadHash = o.PayloadHash
			s.Builder = o.BuilderIndex
			s.SelfBuild = o.SelfBuild
			s.PayloadRetrieved = s.PayloadRetrieved || o.PayloadRetrieved
			s.IdentifiersMatched = s.IdentifiersMatched || o.IdentifiersMatched
			if s.Canonical == nil {
				s.Canonical = boolPtr(o.CanonicalAtFetch)
			}
		}
		if e.Kind == "canonical" && e.Canonical != nil {
			s.Canonical = e.Canonical
		}
	}
	commitments := map[string]time.Time{}
	reveals := map[string]time.Time{}
	for _, e := range events {
		if e.Kind == "block_seen" && e.Timed && e.Session != "" {
			if at, ok := commitments[e.Session]; !ok || e.ObservedAt.Before(at) {
				commitments[e.Session] = e.ObservedAt
			}
		}
		if !selected {
			continue
		}
		if e.Kind == "payload_seen" || e.Kind == "validation" {
			if e.PayloadHash != s.PayloadHash || e.Builder != s.Builder {
				s.Alerts = appendUnique(s.Alerts, "payload_mismatch")
				continue
			}
			s.PayloadRetrieved = true
			s.IdentifiersMatched = true
			if e.Timed && e.Session != "" {
				if at, ok := reveals[e.Session]; !ok || e.ObservedAt.Before(at) {
					reveals[e.Session] = e.ObservedAt
				}
			}
			if e.Valid != nil {
				// Contradictory validation evidence is conservatively retained as failure.
				if s.ExecutionValid == nil || !*e.Valid {
					s.ExecutionValid = e.Valid
					s.ExecutionBasis = "source_reported_validation"
				}
			}
		}
	}
	// Pick the earliest comparable receipt pair from one uninterrupted stream session.
	for session, commit := range commitments {
		if !selected {
			continue
		}
		if reveal, ok := reveals[session]; ok && !reveal.Before(commit) {
			covered := false
			for _, window := range sessions {
				if window.ID == session && !commit.Before(window.Start) && !reveal.After(window.Through) {
					covered = true
					break
				}
			}
			if !covered {
				continue
			}
			if s.CommitmentSeenAt == nil || commit.Before(*s.CommitmentSeenAt) || (commit.Equal(*s.CommitmentSeenAt) && session < s.TimingSession) {
				c, r := commit, reveal
				ms := reveal.Sub(commit).Milliseconds()
				s.CommitmentSeenAt = &c
				s.PayloadSeenAt = &r
				s.RevealLatencyMS = &ms
				s.TimingSession = session
			}
		}
	}
	if s.PayloadRetrieved {
		s.Delivery = "revealed"
	}
	if s.RevealLatencyMS != nil {
		s.Coverage = append(s.Coverage, "same_session_receipt_timing")
		if s.PayloadSeenAt.Sub(*s.CommitmentSeenAt) > policy.LateAfter {
			s.Delivery = "late"
			s.Alerts = appendUnique(s.Alerts, "local_late_payload")
		}
	} else if selected && !s.PayloadRetrieved {
		for _, session := range sessions {
			commit, ok := commitments[session.ID]
			if !ok {
				continue
			}
			deadline := commit.Add(policy.MissingAfter)
			if s.CommitmentSeenAt == nil || commit.Before(*s.CommitmentSeenAt) {
				c := commit
				s.CommitmentSeenAt = &c
			}
			if !commit.Before(session.Start) && !deadline.After(session.Through) && !now.Before(deadline) {
				s.Delivery = "missing"
				s.Alerts = appendUnique(s.Alerts, "local_missing_payload")
				s.Coverage = appendUnique(s.Coverage, "stream_activity_through_local_deadline")
			}
		}
		if s.Delivery != "missing" {
			s.Delivery = "pending"
		}
	}
	payloadYes, payloadNo, blobYes, blobNo := map[int]bool{}, map[int]bool{}, map[int]bool{}, map[int]bool{}
	for _, e := range events {
		if e.Kind != "ptc" || e.Votes == nil {
			continue
		}
		for _, index := range participants(*e.Votes, policy.PTCSize) {
			if e.Votes.PayloadPresent {
				payloadYes[index] = true
			} else {
				payloadNo[index] = true
			}
			if e.Votes.BlobAvailable {
				blobYes[index] = true
			} else {
				blobNo[index] = true
			}
		}
	}
	s.PTCPayloadYes, s.PTCPayloadNo = support(payloadYes, payloadNo)
	s.PTCBlobYes, s.PTCBlobNo = support(blobYes, blobNo)
	conflicts := map[int]bool{}
	for i := range payloadYes {
		if payloadNo[i] {
			conflicts[i] = true
		}
	}
	for i := range blobYes {
		if blobNo[i] {
			conflicts[i] = true
		}
	}
	s.PTCConflictingParticipants = len(conflicts)
	if policy.PTCQuorum > 0 {
		s.PTCTimely = verdict(s.PTCPayloadYes, s.PTCPayloadNo, policy.PTCQuorum)
		s.BlobAvailable = verdict(s.PTCBlobYes, s.PTCBlobNo, policy.PTCQuorum)
	} else {
		s.Coverage = append(s.Coverage, "ptc_verdict_disabled_until_quorum_configured")
	}
	if s.PTCTimely != nil && !*s.PTCTimely {
		s.Alerts = appendUnique(s.Alerts, "ptc_negative_payload_vote")
	}
	if s.BlobAvailable != nil && !*s.BlobAvailable {
		s.Alerts = appendUnique(s.Alerts, "blob_unavailable")
	}
	if s.ExecutionValid != nil && !*s.ExecutionValid {
		s.Alerts = appendUnique(s.Alerts, "execution_invalid")
	}
	if s.RevealLatencyMS == nil {
		s.Coverage = append(s.Coverage, "arrival_timing_unknown")
	}
	if s.ExecutionValid == nil {
		s.Coverage = append(s.Coverage, "execution_validation_unknown")
	}
	if !selected {
		s.Coverage = append(s.Coverage, "selected_commitment_unknown")
	}
	if len(s.Alerts) > 0 {
		s.Status = "warning"
	}
	for _, a := range s.Alerts {
		if a == "payload_mismatch" || a == "execution_invalid" || a == "conflicting_commitment" {
			s.Status = "failed"
		}
	}
	if len(s.Alerts) == 0 && selected && s.PayloadRetrieved && s.IdentifiersMatched && s.PTCTimely != nil && *s.PTCTimely && s.BlobAvailable != nil && *s.BlobAvailable && s.ExecutionValid != nil && *s.ExecutionValid {
		s.Status = "healthy"
	}
	if s.Canonical != nil && !*s.Canonical {
		s.Coverage = append(s.Coverage, "orphaned_at_last_reconciliation")
	}
	sort.Strings(s.Alerts)
	return s
}
func appendUnique(values []string, value string) []string {
	for _, v := range values {
		if v == value {
			return values
		}
	}
	return append(values, value)
}
func participants(v Votes, size int) []int {
	indices := []int{}
	if v.Bits != "" {
		data, err := hex.DecodeString(strings.TrimPrefix(v.Bits, "0x"))
		if err != nil || size <= 0 || len(data)*8 != size {
			return indices
		}
		for i, b := range data {
			for bit := 0; bit < 8; bit++ {
				if b&(1<<bit) != 0 {
					indices = append(indices, i*8+bit)
				}
			}
		}
	}
	// Individual validator indices are not committee positions. Preserve their raw
	// votes, but do not mix them with aggregate bits without a committee mapping.
	return indices
}
func support(yes, no map[int]bool) (int, int) {
	a, b := 0, 0
	for i := range yes {
		if !no[i] {
			a++
		}
	}
	for i := range no {
		if !yes[i] {
			b++
		}
	}
	return a, b
}
func verdict(yes, no, quorum int) *bool {
	if yes >= quorum && no >= quorum {
		return nil
	}
	if yes >= quorum {
		return boolPtr(true)
	}
	if no >= quorum {
		return boolPtr(false)
	}
	return nil
}

func decimalSlot(s string) (uint64, error) { return strconv.ParseUint(s, 10, 64) }
