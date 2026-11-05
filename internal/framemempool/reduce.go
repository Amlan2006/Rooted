package framemempool

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

func quantity(s string) (uint64, error) {
	return strconv.ParseUint(strings.TrimPrefix(s, "0x"), 16, 64)
}
func truth(v bool) *bool { return &v }
func Reduce(scope Scope, boot, hash string, a *Admission, events []Event, proof *Proof, firstObserved, now time.Time, timeout time.Duration) State {
	s := State{FirstObservedAt: firstObserved, Scope: scope, Boot: boot, Hash: hash, Admission: a, Proof: proof, Status: "unknown", Coverage: []string{}, Incidents: []string{}, UpdatedAt: now}
	s.Events = append([]Event{}, events...)
	sort.Slice(s.Events, func(i, j int) bool { return s.Events[i].Seq < s.Events[j].Seq })
	var admitted, included *int64
	if a != nil {
		switch a.Outcome {
		case "accepted":
			s.Status = "admitted"
			if a.PoolStatus == "Submitted" {
				s.Status = "submitted"
			}
			s.AdmissionConfirmed = true
		case "included":
			s.Status = "included_reported"
			s.AdmissionConfirmed = true
		case "rejected":
			s.Status = "rejected"
			s.Incidents = append(s.Incidents, "admission_rejected")
		case "replaced":
			s.Status = "replaced"
			s.AdmissionConfirmed = true
		case "dropped":
			s.Status = "dropped_reported"
			s.Incidents = unique(s.Incidents, "source_dropped")
			s.AdmissionConfirmed = true
		}
	}
	for _, e := range s.Events {
		applyStatus := a == nil || e.Seq > a.ObservedEventSeq
		switch e.Kind {
		case "admitted":
			s.AdmissionConfirmed = true
			if admitted == nil {
				v := e.At
				admitted = &v
			}
			if included == nil && applyStatus {
				s.Status = "admitted"
			}
		case "rejected":
			if !s.AdmissionConfirmed && included == nil && applyStatus {
				s.Status = "rejected"
			}
			s.Incidents = unique(s.Incidents, "admission_rejected")
		case "replaced":
			if included == nil && applyStatus {
				s.Status = "replaced"
			}
		case "dropped":
			if included == nil && applyStatus {
				s.Status = "dropped_reported"
				s.Incidents = unique(s.Incidents, "source_dropped")
			}
		case "statusChanged":
			if included == nil && e.Status == "Submitted" && applyStatus {
				s.Status = "submitted"
			}
		case "included":
			v := e.At
			included = &v
			s.AdmissionConfirmed = true
			s.Status = "included_reported"
		}
	}
	// The admission snapshot is the node's current verdict. Some state changes emit no event.
	if a != nil && a.Outcome == "rejected" && !s.AdmissionConfirmed {
		s.Status = "rejected"
	}
	if a != nil && a.Outcome == "included" {
		s.AdmissionConfirmed = true
		s.Status = "included_reported"
	}
	if admitted != nil && included != nil && *included >= *admitted {
		v := *included - *admitted
		s.AdmissionToInclusionMS = &v
	}
	if proof != nil {
		if proof.Receipt != nil && proof.IdentityMatched && proof.Canonical != nil && *proof.Canonical {
			s.InclusionConfirmed = true
			s.Status = "included"
			s.ExecutionSuccess = truth(proof.Receipt.Status == "0x1")
			if !*s.ExecutionSuccess {
				s.Status = "reverted"
				s.Incidents = unique(s.Incidents, "execution_reverted")
			}
		} else if proof.Receipt != nil && !proof.IdentityMatched {
			s.Incidents = unique(s.Incidents, "receipt_identity_mismatch")
			s.Status = "evidence_conflict"
		} else if proof.Canonical != nil && !*proof.Canonical {
			s.Status = "reorged"
			s.Incidents = unique(s.Incidents, "receipt_orphaned")
		}
		s.Coverage = append(s.Coverage, proof.Coverage...)
	}
	if !s.AdmissionConfirmed {
		s.Coverage = unique(s.Coverage, "successful_admission_not_observed")
	}
	if !s.InclusionConfirmed {
		s.Coverage = unique(s.Coverage, "canonical_inclusion_not_confirmed")
	}
	if s.AdmissionToInclusionMS == nil {
		s.Coverage = unique(s.Coverage, "same_node_admission_to_inclusion_timing_unknown")
	}
	// Age is time since this collector first observed the transaction; it is not a drop verdict.
	if s.AdmissionConfirmed && !s.InclusionConfirmed && s.Status != "replaced" && s.Status != "dropped_reported" && s.Status != "reorged" && s.Status != "evidence_conflict" {
		if !firstObserved.IsZero() && now.Sub(firstObserved) > timeout {
			s.Coverage = unique(s.Coverage, "inclusion_observation_window_elapsed")
			s.Incidents = unique(s.Incidents, "inclusion_unresolved")
		}
	}
	return s
}
func unique(values []string, s string) []string {
	for _, v := range values {
		if v == s {
			return values
		}
	}
	return append(values, s)
}
