package payloadwatch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"time"
)

type Dataset struct {
	Network  string    `json:"network"`
	Mode     string    `json:"mode"`
	SourceID string    `json:"source_id"`
	Sessions []Session `json:"sessions"`
	Events   []Event   `json:"events"`
	// Fixture policy applies only to synthetic data, never to the live collector.
	Policy *FixturePolicy `json:"policy,omitempty"`
}
type FixturePolicy struct {
	LateMS    int64 `json:"late_ms"`
	MissingMS int64 `json:"missing_ms"`
	Size      int   `json:"ptc_size"`
	Quorum    int   `json:"ptc_quorum"`
}
type ReplayResult struct {
	Inserted   int     `json:"inserted"`
	Duplicates int     `json:"duplicates"`
	States     []State `json:"states"`
}

// DecodeDataset validates a bounded, explicitly scoped replay before any writes.
// It can also be used to inspect synthetic evidence without a database.
func DecodeDataset(reader io.Reader, network string) (Dataset, error) {
	var d Dataset
	const maximum = 32 << 20
	raw, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return d, err
	}
	if len(raw) > maximum {
		return d, errors.New("replay dataset exceeds 32 MiB")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return d, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return d, errors.New("expected one JSON dataset")
	}
	if d.Network != network || d.SourceID == "" || len(d.SourceID) > 100 || (d.Mode != "replay" && d.Mode != "synthetic") {
		return d, errors.New("replay needs matching network, explicit source and replay/synthetic mode")
	}
	if d.Policy != nil {
		p := d.Policy
		if d.Mode != "synthetic" || p.LateMS <= 0 || p.MissingMS < p.LateMS || p.MissingMS > 3600000 || p.Size <= 0 || p.Size > 8192 || p.Size%8 != 0 || p.Quorum <= 0 || p.Quorum > p.Size {
			return d, errors.New("invalid synthetic fixture policy")
		}
	}
	for _, e := range d.Events {
		if e.Mode != d.Mode || e.Network != d.Network || e.SourceID != d.SourceID {
			return d, errors.New("mixed replay identities")
		}
	}
	for _, session := range d.Sessions {
		if session.ID == "" || session.Start.IsZero() || session.Through.Before(session.Start) {
			return d, errors.New("invalid coverage session")
		}
	}
	return d, nil
}

func Replay(ctx context.Context, engine *Engine, reader io.Reader, network string) (ReplayResult, error) {
	var result ReplayResult
	d, err := DecodeDataset(reader, network)
	if err != nil {
		return result, err
	}
	worker := *engine
	if d.Policy != nil {
		p := d.Policy
		worker.Policy = Policy{LateAfter: time.Duration(p.LateMS) * time.Millisecond, MissingAfter: time.Duration(p.MissingMS) * time.Millisecond, PTCSize: p.Size, PTCQuorum: p.Quorum}
	}
	var through time.Time
	// Replay the evidence clock in order, so transport ordering cannot create
	// transient missing incidents before an earlier recorded reveal is imported.
	sort.SliceStable(d.Events, func(i, j int) bool { return d.Events[i].ObservedAt.Before(d.Events[j].ObservedAt) })
	for _, s := range d.Sessions {
		if err := worker.Session(ctx, d.Network, d.Mode, d.SourceID, s); err != nil {
			return result, err
		}
		if s.Through.After(through) {
			through = s.Through
		}
	}
	for _, e := range d.Events {
		_, inserted, err := worker.Apply(ctx, e)
		if err != nil {
			return result, err
		}
		if inserted {
			result.Inserted++
		} else {
			result.Duplicates++
		}
		if e.ObservedAt.After(through) {
			through = e.ObservedAt
		}
	}
	if err := worker.Refresh(ctx, d.Network, d.Mode, d.SourceID, through); err != nil {
		return result, err
	}
	states, err := worker.States(ctx, d.Network, d.Mode, d.SourceID, nil, "", 200)
	result.States = states
	return result, err
}
