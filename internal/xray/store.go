package xray

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/ingest"
)

type Store struct{ Pool *pgxpool.Pool }

// Save upserts; the latest measurement of a block wins.
func (s *Store) Save(ctx context.Context, r Report) error {
	if r.Schema != Schema || r.Network != "sepolia" || !ingest.ValidRoot(r.Block.Hash) || r.ComputedAt.IsZero() {
		return errors.New("invalid X-ray report identity")
	}
	brief, err := json.Marshal(BriefOf(r))
	if err != nil {
		return err
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO xray_reports(block_hash,network,block_number,slot,source,computed_at,profile_id,brief,report) VALUES($1,'sepolia',$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT(block_hash) DO UPDATE SET block_number=EXCLUDED.block_number,slot=EXCLUDED.slot,source=EXCLUDED.source,computed_at=EXCLUDED.computed_at,profile_id=EXCLUDED.profile_id,brief=EXCLUDED.brief,report=EXCLUDED.report`,
		r.Block.Hash, int64(r.Block.Number), r.Block.Slot, r.Source, r.ComputedAt, r.ProfileID, brief, raw)
	return err
}

// Get returns pgx.ErrNoRows when the block has no stored report.
func (s *Store) Get(ctx context.Context, hash string) (Report, error) {
	var raw []byte
	var r Report
	if err := s.Pool.QueryRow(ctx, `SELECT report FROM xray_reports WHERE block_hash=$1 AND network='sepolia'`, hash).Scan(&raw); err != nil {
		return r, err
	}
	if json.Unmarshal(raw, &r) != nil {
		return r, errors.New("stored X-ray schema unavailable")
	}
	return r, nil
}
func (s *Store) Has(ctx context.Context, hash string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM xray_reports WHERE block_hash=$1 AND network='sepolia')`, hash).Scan(&ok)
	return ok, err
}
func (s *Store) List(ctx context.Context, limit int) ([]Brief, error) {
	rows, err := s.Pool.Query(ctx, `SELECT brief FROM xray_reports WHERE network='sepolia' ORDER BY block_number DESC,block_hash LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Brief{}
	for rows.Next() {
		var raw []byte
		var b Brief
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if json.Unmarshal(raw, &b) != nil {
			return nil, errors.New("stored X-ray brief schema unavailable")
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// EPBS projects the latest live PayloadWatch state for the payload, or nil when none exists.
func (s *Store) EPBS(ctx context.Context, hash string) (*EPBS, error) {
	var e EPBS
	var slot int64
	var raw []byte
	err := s.Pool.QueryRow(ctx, `SELECT slot::bigint,block_root,state FROM pw_states WHERE network='sepolia' AND mode='live' AND state->>'payload_hash'=$1 ORDER BY updated_at DESC LIMIT 1`, hash).Scan(&slot, &e.BeaconBlockRoot, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var state struct {
		Builder   string  `json:"builder_index"`
		SelfBuild *bool   `json:"self_build"`
		Status    *string `json:"status"`
		Delivery  *string `json:"delivery"`
		Latency   *int64  `json:"reveal_latency_ms"`
		Yes       *int    `json:"ptc_payload_yes"`
		No        *int    `json:"ptc_payload_no"`
		Timely    *bool   `json:"ptc_timely"`
		Canonical *bool   `json:"canonical"`
	}
	if json.Unmarshal(raw, &state) != nil {
		return nil, errors.New("stored PayloadWatch state schema unavailable")
	}
	e.Slot, e.BuilderIndex, e.Source = uint64(slot), state.Builder, "payloadwatch"
	e.SelfBuild, e.Status, e.Delivery, e.RevealLatencyMS, e.PTCPayloadYes, e.PTCPayloadNo, e.PTCTimely, e.Canonical = state.SelfBuild, state.Status, state.Delivery, state.Latency, state.Yes, state.No, state.Timely, state.Canonical
	return &e, nil
}

// LatestProfile returns the newest saved execution profile id for the block, or "" when none exists.
func (s *Store) LatestProfile(ctx context.Context, hash string) (string, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `SELECT id FROM execution_profiles WHERE network='sepolia' AND mode='replay' AND block_hash=$1 ORDER BY created_at DESC,id LIMIT 1`, hash).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}
