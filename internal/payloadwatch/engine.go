package payloadwatch

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/ingest"
)

type Engine struct {
	Pool   *pgxpool.Pool
	Policy Policy
}

func EventID(e Event) string {
	e.ID = ""
	e.ObservedAt = time.Time{}
	e.Session = ""
	if e.Snapshot != nil {
		o := *e.Snapshot
		o.FetchedAt = time.Time{}
		o.Sources = nil
		e.Snapshot = &o
	}
	b, _ := json.Marshal(e)
	var canonical any
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.UseNumber()
	_ = decoder.Decode(&canonical)
	b, _ = json.Marshal(canonical)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func (p *Engine) Apply(ctx context.Context, e Event) (State, bool, error) {
	if e.Mode != "live" && e.Mode != "replay" && e.Mode != "synthetic" {
		return State{}, false, errors.New("invalid evidence mode")
	}
	if e.Network == "" || e.SourceID == "" || e.ObservedAt.IsZero() || !ingest.ValidRoot(e.Root) {
		return State{}, false, errors.New("invalid event identity")
	}
	e.Root = strings.ToLower(e.Root)
	e.PayloadHash = strings.ToLower(e.PayloadHash)
	switch e.Kind {
	case "snapshot", "block_seen", "payload_seen", "validation", "ptc", "canonical":
	default:
		return State{}, false, errors.New("unsupported event kind")
	}
	if e.Snapshot != nil && (e.Snapshot.Network != e.Network || e.Snapshot.Slot != e.Slot || e.Snapshot.BlockRoot != e.Root) {
		return State{}, false, errors.New("snapshot identity mismatch")
	}
	if e.Kind == "snapshot" && e.Snapshot == nil {
		return State{}, false, errors.New("snapshot evidence missing")
	}
	if (e.Kind == "payload_seen" || e.Kind == "validation") && (!ingest.ValidRoot(e.PayloadHash) || e.Builder == "") {
		return State{}, false, errors.New("payload event identity missing")
	}
	if e.ID == "" {
		e.ID = EventID(e)
	}
	body, err := json.Marshal(e)
	if err != nil {
		return State{}, false, err
	}
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return State{}, false, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(78150631)"); err != nil {
		return State{}, false, err
	}
	if err = lockRoot(ctx, tx, e.Network, e.Mode, e.SourceID, e.Slot, e.Root); err != nil {
		return State{}, false, err
	}
	var seq int64
	err = tx.QueryRow(ctx, `INSERT INTO pw_events(network,mode,source_id,event_id,slot,block_root,kind,observed_at,event)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(network,mode,source_id,event_id) DO NOTHING RETURNING seq`, e.Network, e.Mode, e.SourceID, e.ID, strconv.FormatUint(e.Slot, 10), e.Root, e.Kind, e.ObservedAt, body).Scan(&seq)
	inserted := !errors.Is(err, pgx.ErrNoRows)
	if err != nil && inserted {
		return State{}, false, err
	}
	if !inserted {
		var original []byte
		var previous Event
		if err = tx.QueryRow(ctx, `SELECT event FROM pw_events WHERE network=$1 AND mode=$2 AND source_id=$3 AND event_id=$4`, e.Network, e.Mode, e.SourceID, e.ID).Scan(&original); err != nil {
			return State{}, false, err
		}
		if err = json.Unmarshal(original, &previous); err != nil {
			return State{}, false, err
		}
		if EventID(previous) != EventID(e) {
			return State{}, false, errors.New("event ID reused for different evidence")
		}
	}
	// Raw evidence is inserted before projection and committed atomically with it.
	now := time.Now().UTC()
	if e.Mode != "live" {
		now = e.ObservedAt
	}
	state, err := p.project(ctx, tx, e.Network, e.Mode, e.SourceID, e.Slot, e.Root, now)
	if err != nil {
		return state, false, err
	}
	return state, inserted, tx.Commit(ctx)
}

func lockRoot(ctx context.Context, tx pgx.Tx, network, mode, source string, slot uint64, root string) error {
	_, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", fmt.Sprintf("%s|%s|%s|%d|%s", network, mode, source, slot, root))
	return err
}
func (p *Engine) project(ctx context.Context, tx pgx.Tx, network, mode, source string, slot uint64, root string, now time.Time) (State, error) {
	slotText := strconv.FormatUint(slot, 10)
	rows, err := tx.Query(ctx, `SELECT event FROM pw_events WHERE network=$1 AND mode=$2 AND source_id=$3 AND slot=$4 AND block_root=$5 ORDER BY seq`, network, mode, source, slotText, root)
	if err != nil {
		return State{}, err
	}
	events := []Event{}
	for rows.Next() {
		var raw []byte
		var e Event
		if err = rows.Scan(&raw); err != nil {
			rows.Close()
			return State{}, err
		}
		if err = json.Unmarshal(raw, &e); err != nil {
			rows.Close()
			return State{}, err
		}
		events = append(events, e)
		if mode != "live" && e.ObservedAt.After(now) {
			now = e.ObservedAt
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return State{}, err
	}
	sessionRows, err := tx.Query(ctx, `SELECT session_id,started_at,last_activity,closed FROM pw_sessions WHERE network=$1 AND mode=$2 AND source_id=$3`, network, mode, source)
	if err != nil {
		return State{}, err
	}
	sessions := []Session{}
	for sessionRows.Next() {
		var s Session
		if err = sessionRows.Scan(&s.ID, &s.Start, &s.Through, &s.Closed); err != nil {
			sessionRows.Close()
			return State{}, err
		}
		sessions = append(sessions, s)
	}
	err = sessionRows.Err()
	sessionRows.Close()
	if err != nil {
		return State{}, err
	}
	state := Reduce(events, sessions, p.Policy, now)
	body, err := json.Marshal(state)
	if err != nil {
		return state, err
	}
	var builder any
	if state.Builder != "" {
		builder = state.Builder
	}
	_, err = tx.Exec(ctx, `INSERT INTO pw_states(network,mode,source_id,slot,block_root,builder_index,canonical,updated_at,state)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(network,mode,source_id,slot,block_root)
DO UPDATE SET builder_index=EXCLUDED.builder_index,canonical=EXCLUDED.canonical,updated_at=EXCLUDED.updated_at,state=EXCLUDED.state`, network, mode, source, slotText, root, builder, state.Canonical, now, body)
	if err != nil {
		return state, err
	}
	active := state.Alerts
	if state.Canonical != nil && !*state.Canonical {
		active = []string{}
	}
	_, err = tx.Exec(ctx, `UPDATE pw_alerts SET active=false,resolved_at=$6 WHERE network=$1 AND mode=$2 AND source_id=$3 AND slot=$4 AND block_root=$5 AND active AND code<>ALL($7::text[])`, network, mode, source, slotText, root, now, active)
	if err != nil {
		return state, err
	}
	outcomes := append([]string(nil), state.Alerts...)
	if state.PayloadRetrieved && state.Builder != "" {
		outcomes = appendUnique(outcomes, "payload_observed")
	}
	if state.PTCTimely != nil && *state.PTCTimely {
		outcomes = appendUnique(outcomes, "ptc_positive_payload_vote")
	}
	for _, outcome := range outcomes {
		_, err = tx.Exec(ctx, `INSERT INTO pw_outcomes(network,mode,source_id,slot,block_root,outcome,detected_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, network, mode, source, slotText, root, outcome, now)
		if err != nil {
			return state, err
		}
	}
	for _, alert := range active {
		_, err = tx.Exec(ctx, `INSERT INTO pw_alerts(network,mode,source_id,slot,block_root,code,first_detected_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,true)
ON CONFLICT(network,mode,source_id,slot,block_root,code) DO UPDATE SET active=true,resolved_at=NULL`, network, mode, source, slotText, root, alert, now)
		if err != nil {
			return state, err
		}
	}
	if state.RevealLatencyMS != nil {
		_, err = tx.Exec(ctx, `INSERT INTO pw_latency_samples(network,mode,source_id,slot,block_root,latency_ms) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, network, mode, source, slotText, root, *state.RevealLatencyMS)
		if err != nil {
			return state, err
		}
	}
	return state, nil
}

func (p *Engine) Session(ctx context.Context, network, mode, source string, s Session) error {
	if s.ID == "" || s.Start.IsZero() || s.Through.Before(s.Start) {
		return errors.New("invalid coverage session")
	}
	_, err := p.Pool.Exec(ctx, `INSERT INTO pw_sessions(network,mode,source_id,session_id,started_at,last_activity,closed) VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT(network,mode,source_id,session_id) DO UPDATE SET last_activity=CASE WHEN pw_sessions.closed THEN pw_sessions.last_activity ELSE GREATEST(pw_sessions.last_activity,EXCLUDED.last_activity) END,closed=pw_sessions.closed OR EXCLUDED.closed`, network, mode, source, s.ID, s.Start, s.Through, s.Closed)
	return err
}
func (p *Engine) CloseOldSessions(ctx context.Context, network, source string) error {
	_, err := p.Pool.Exec(ctx, `UPDATE pw_sessions SET closed=true WHERE network=$1 AND source_id=$2 AND mode='live' AND NOT closed`, network, source)
	return err
}
func (p *Engine) Refresh(ctx context.Context, network, mode, source string, now time.Time) error {
	rows, err := p.Pool.Query(ctx, `SELECT slot::text,block_root FROM pw_states WHERE network=$1 AND mode=$2 AND source_id=$3 AND builder_index IS NOT NULL AND state->>'delivery'='pending' ORDER BY slot DESC LIMIT 100`, network, mode, source)
	if err != nil {
		return err
	}
	type key struct {
		slot string
		root string
	}
	keys := []key{}
	for rows.Next() {
		var k key
		if err = rows.Scan(&k.slot, &k.root); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, k)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, k := range keys {
		slot, _ := decimalSlot(k.slot)
		tx, err := p.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		if err = lockRoot(ctx, tx, network, mode, source, slot, k.root); err == nil {
			_, err = p.project(ctx, tx, network, mode, source, slot, k.root, now)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}
func (p *Engine) Reconcile(ctx context.Context, network, mode, source string, slot uint64, root string, at time.Time) error {
	states, err := p.States(ctx, network, mode, source, &slot, "", 200)
	if err != nil {
		return err
	}
	for _, s := range states {
		canonical := s.Root == root
		if s.Canonical != nil && *s.Canonical == canonical {
			continue
		}
		_, _, err = p.Apply(ctx, Event{ID: fmt.Sprintf("canonical:%s:%d", s.Root, at.UnixNano()), Network: network, Mode: mode, SourceID: source, Kind: "canonical", Slot: slot, Root: s.Root, Canonical: &canonical, ObservedAt: at})
		if err != nil {
			return err
		}
	}
	return nil
}
func (p *Engine) States(ctx context.Context, network, mode, source string, slot *uint64, builder string, limit int) ([]State, error) {
	var slotValue any
	if slot != nil {
		slotValue = strconv.FormatUint(*slot, 10)
	}
	rows, err := p.Pool.Query(ctx, `SELECT state FROM pw_states WHERE network=$1 AND mode=$2 AND source_id=$3 AND ($4::numeric IS NULL OR slot=$4) AND ($5='' OR builder_index=$5) ORDER BY slot DESC,block_root LIMIT $6`, network, mode, source, slotValue, builder, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []State{}
	for rows.Next() {
		var raw []byte
		var s State
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &s); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

type Progress struct {
	LastSlot     *string    `json:"last_slot"`
	LastSuccess  *time.Time `json:"last_success"`
	StreamStatus string     `json:"stream_status"`
	PollStatus   string     `json:"poll_status"`
}

func (p *Engine) Progress(ctx context.Context, network, source string) (Progress, error) {
	var value Progress
	err := p.Pool.QueryRow(ctx, `SELECT last_slot::text,last_success,stream_status,poll_status FROM pw_progress WHERE network=$1 AND source_id=$2`, network, source).Scan(&value.LastSlot, &value.LastSuccess, &value.StreamStatus, &value.PollStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return Progress{StreamStatus: "not_started", PollStatus: "not_started"}, nil
	}
	return value, err
}
func (p *Engine) SetProgress(ctx context.Context, network, source, kind, status string, slot *uint64) error {
	_, err := p.Pool.Exec(ctx, `INSERT INTO pw_progress(network,source_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, network, source)
	if err != nil {
		return err
	}
	if kind == "stream" {
		_, err = p.Pool.Exec(ctx, `UPDATE pw_progress SET stream_status=$3 WHERE network=$1 AND source_id=$2`, network, source, status)
		return err
	}
	var value any
	if slot != nil {
		value = strconv.FormatUint(*slot, 10)
	}
	_, err = p.Pool.Exec(ctx, `UPDATE pw_progress SET poll_status=$3,last_slot=COALESCE($4::numeric,last_slot),last_success=CASE WHEN $3='ok' THEN now() ELSE last_success END WHERE network=$1 AND source_id=$2`, network, source, status, value)
	return err
}
