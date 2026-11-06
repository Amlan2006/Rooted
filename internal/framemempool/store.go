package framemempool

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/ingest"
	"strconv"
	"strings"
	"time"
)

type Store struct {
	Pool              *pgxpool.Pool
	ObservationWindow time.Duration
}

func validScope(s Scope) bool {
	return s.Network != "" && s.Node != "" && len(s.Node) <= 100 && (s.Mode == "live" || s.Mode == "captured" || s.Mode == "synthetic")
}
func canonical(raw []byte) ([]byte, error) {
	if !json.Valid(raw) {
		return nil, errors.New("frame evidence must contain one valid JSON value")
	}
	var value any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := d.Decode(&value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}
func digest(raw []byte) (string, error) {
	b, err := canonical(raw)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}
func begin(ctx context.Context, p *pgxpool.Pool, s Scope) (pgx.Tx, error) {
	if !validScope(s) {
		return nil, errors.New("invalid frame scope")
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", fmt.Sprintf("frame|%s|%s|%s", s.Network, s.Mode, s.Node))
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}
func saveRaw(ctx context.Context, tx pgx.Tx, s Scope, boot string, r Raw) error {
	if len(r.Body) == 0 {
		return nil
	}
	hash, err := digest(r.Body)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO frame_raw(network,mode,node_id,boot_id,method,entity,digest,body,first_seen,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
 ON CONFLICT(network,mode,node_id,boot_id,method,entity,digest) DO UPDATE SET last_seen=GREATEST(frame_raw.last_seen,EXCLUDED.last_seen)`, s.Network, s.Mode, s.Node, boot, r.Method, r.Entity, hash, r.Body, r.At)
	return err
}
func incident(ctx context.Context, tx pgx.Tx, s Scope, boot, hash, code, identity string, at time.Time, detail any) error {
	b, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO frame_incidents(network,mode,node_id,boot_id,tx_hash,code,identity,observed_at,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, s.Network, s.Mode, s.Node, boot, hash, code, identity, at, b)
	return err
}
func (s *Store) Register(ctx context.Context, scope Scope, info Info, genesis string, records []Raw, at time.Time) (NodeState, error) {
	tx, err := begin(ctx, s.Pool, scope)
	if err != nil {
		return NodeState{}, err
	}
	defer tx.Rollback(ctx)
	var oldBoot, oldChain, oldGenesis string
	var seq int64
	var previous time.Time
	err = tx.QueryRow(ctx, `SELECT boot_id,chain_id,genesis_hash,stream_seq,updated_at FROM frame_nodes WHERE network=$1 AND mode=$2 AND node_id=$3 FOR UPDATE`, scope.Network, scope.Mode, scope.Node).Scan(&oldBoot, &oldChain, &oldGenesis, &seq, &previous)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return NodeState{}, err
	}
	chain := strconv.FormatUint(info.ChainID, 10)
	if oldChain != "" && oldChain != chain {
		return NodeState{}, errors.New("frame network identity changed; configure a distinct network/node scope")
	}
	if oldBoot != "" && at.Before(previous) {
		if oldBoot != info.Boot {
			return NodeState{}, errors.New("stale frame node identity")
		}
		// Concurrent HTTP polling and stream bootstrap may finish out of order.
		// Preserve fresher metadata while retaining the raw older observation.
		for _, r := range records {
			if err = saveRaw(ctx, tx, scope, info.Boot, r); err != nil {
				return NodeState{}, err
			}
		}
		if err = tx.Commit(ctx); err != nil {
			return NodeState{}, err
		}
		return s.Node(ctx, scope)
	}
	if oldGenesis != "" && !strings.EqualFold(oldGenesis, genesis) {
		// A devnet reset starts a new epoch in the same scope; old rows stay archived.
		seq = 0
		if err = incident(ctx, tx, scope, info.Boot, "", "devnet_reset", oldGenesis+":"+genesis, at, map[string]any{"previous_genesis": oldGenesis, "current_genesis": genesis, "previous_boot": oldBoot, "current_boot": info.Boot}); err != nil {
			return NodeState{}, err
		}
	} else if oldBoot != info.Boot {
		seq = 0
		if oldBoot != "" {
			if err = incident(ctx, tx, scope, info.Boot, "", "node_restarted", oldBoot+":"+info.Boot, at, map[string]any{"previous_boot": oldBoot, "current_boot": info.Boot, "coverage": "old history may no longer be available"}); err != nil {
				return NodeState{}, err
			}
		}
	}
	if info.Oldest > seq+1 {
		if err = incident(ctx, tx, scope, info.Boot, "", "history_gap", fmt.Sprintf("%d:%d", seq+1, info.Oldest-1), at, map[string]any{"first_missing_seq": seq + 1, "last_missing_seq": info.Oldest - 1}); err != nil {
			return NodeState{}, err
		}
		seq = info.Oldest - 1
	}
	if seq > info.Latest {
		info.Latest = seq
	} // Already journaled stream evidence can precede this HTTP snapshot.

	for _, r := range records {
		if err = saveRaw(ctx, tx, scope, info.Boot, r); err != nil {
			return NodeState{}, err
		}
	}
	body, _ := json.Marshal(info)
	_, err = tx.Exec(ctx, `INSERT INTO frame_nodes(network,mode,node_id,chain_id,genesis_hash,boot_id,info,updated_at,stream_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
 ON CONFLICT(network,mode,node_id) DO UPDATE SET boot_id=EXCLUDED.boot_id,genesis_hash=EXCLUDED.genesis_hash,info=EXCLUDED.info,updated_at=EXCLUDED.updated_at,stream_seq=EXCLUDED.stream_seq,
 scan_cursor=CASE WHEN frame_nodes.boot_id<>EXCLUDED.boot_id OR lower(frame_nodes.genesis_hash)<>lower(EXCLUDED.genesis_hash) THEN NULL ELSE frame_nodes.scan_cursor END`, scope.Network, scope.Mode, scope.Node, chain, genesis, info.Boot, body, at, seq)
	if err != nil {
		return NodeState{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return NodeState{}, err
	}
	return s.Node(ctx, scope)
}
func (s *Store) Node(ctx context.Context, scope Scope) (NodeState, error) {
	n := NodeState{Scope: scope}
	var body []byte
	err := s.Pool.QueryRow(ctx, `SELECT chain_id,genesis_hash,info,updated_at,poll_status,stream_status,scan_cursor,stream_seq FROM frame_nodes WHERE network=$1 AND mode=$2 AND node_id=$3`, scope.Network, scope.Mode, scope.Node).Scan(&n.ChainID, &n.Genesis, &body, &n.UpdatedAt, &n.Poll, &n.Stream, &n.Cursor, &n.Seq)
	if err != nil {
		return n, err
	}
	err = json.Unmarshal(body, &n.Info)
	return n, err
}
func (s *Store) Status(ctx context.Context, scope Scope, boot, kind, status string, cursor *string) error {
	if kind == "stream" {
		_, err := s.Pool.Exec(ctx, `UPDATE frame_nodes SET stream_status=$5 WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4`, scope.Network, scope.Mode, scope.Node, boot, status)
		return err
	}
	_, err := s.Pool.Exec(ctx, `UPDATE frame_nodes SET poll_status=$5,scan_cursor=$6 WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4`, scope.Network, scope.Mode, scope.Node, boot, status, cursor)
	return err
}
func (s *Store) Raw(ctx context.Context, scope Scope, boot string, r Raw) error {
	tx, err := begin(ctx, s.Pool, scope)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = saveRaw(ctx, tx, scope, boot, r); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func validateEvent(e Event) error {
	if e.Seq <= 0 || e.At <= 0 || !ingest.ValidRoot(e.Hash) {
		return errors.New("invalid frame event identity")
	}
	switch e.Kind {
	case "admitted", "rejected", "replaced", "dropped", "statusChanged", "included":
		return nil
	}
	return errors.New("unsupported frame lifecycle kind")
}
func saveEvent(ctx context.Context, tx pgx.Tx, scope Scope, boot string, e Event, at time.Time) error {
	if err := validateEvent(e); err != nil {
		return err
	}
	e.Hash = strings.ToLower(e.Hash)
	body, _ := json.Marshal(e)
	tag, err := tx.Exec(ctx, `INSERT INTO frame_events(network,mode,node_id,boot_id,seq,tx_hash,source_at,kind,observed_at,event) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, scope.Network, scope.Mode, scope.Node, boot, e.Seq, e.Hash, e.At, e.Kind, at, body)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var old []byte
		if err = tx.QueryRow(ctx, `SELECT event FROM frame_events WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4 AND seq=$5`, scope.Network, scope.Mode, scope.Node, boot, e.Seq).Scan(&old); err != nil {
			return err
		}
		a, _ := digest(old)
		b, _ := digest(body)
		if a != b {
			return errors.New("frame sequence reused for different evidence")
		}
	}
	return nil
}
func (s *Store) Detail(ctx context.Context, scope Scope, boot string, d Detail, raw Raw) (State, error) {
	if !ingest.ValidRoot(d.Hash) || boot == "" {
		return State{}, errors.New("invalid frame transaction identity")
	}
	d.Hash = strings.ToLower(d.Hash)
	tx, err := begin(ctx, s.Pool, scope)
	if err != nil {
		return State{}, err
	}
	defer tx.Rollback(ctx)
	if err = saveRaw(ctx, tx, scope, boot, raw); err != nil {
		return State{}, err
	}
	if d.Admission != nil {
		a := d.Admission
		if !strings.EqualFold(a.Hash, d.Hash) || a.ID <= 0 || a.At <= 0 {
			return State{}, errors.New("frame admission identity mismatch")
		}
		a.Hash = d.Hash
		var previousID int64
		idErr := tx.QueryRow(ctx, `SELECT admission_id FROM frame_admissions WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4 AND tx_hash=$5`, scope.Network, scope.Mode, scope.Node, boot, d.Hash).Scan(&previousID)
		if idErr != nil && !errors.Is(idErr, pgx.ErrNoRows) {
			return State{}, idErr
		}
		if idErr == nil && previousID != a.ID {
			return State{}, errors.New("admission ID changed within one node boot")
		}
		for _, event := range d.Events {
			if event.Seq > a.ObservedEventSeq {
				a.ObservedEventSeq = event.Seq
			}
		}
		var entry struct {
			Status string `json:"status"`
		}
		if len(d.Entry) > 0 && json.Unmarshal(d.Entry, &entry) == nil {
			a.PoolStatus = entry.Status
		}
		switch a.Outcome {
		case "accepted", "rejected", "included", "replaced", "dropped":
		default:
			return State{}, errors.New("unknown frame admission outcome")
		}
		body, _ := json.Marshal(a)
		_, err = tx.Exec(ctx, `INSERT INTO frame_admissions(network,mode,node_id,boot_id,admission_id,tx_hash,source_at,observed_at,admission) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
 ON CONFLICT(network,mode,node_id,boot_id,tx_hash) DO UPDATE SET admission=EXCLUDED.admission,observed_at=EXCLUDED.observed_at WHERE frame_admissions.admission_id=EXCLUDED.admission_id AND frame_admissions.observed_at<=EXCLUDED.observed_at`, scope.Network, scope.Mode, scope.Node, boot, a.ID, d.Hash, a.At, raw.At, body)
		if err != nil {
			return State{}, err
		}
	}
	for _, e := range d.Events {
		if !strings.EqualFold(e.Hash, d.Hash) {
			return State{}, errors.New("frame detail contains another transaction")
		}
		if err = saveEvent(ctx, tx, scope, boot, e, raw.At); err != nil {
			return State{}, err
		}
	}
	state, err := s.project(ctx, tx, scope, boot, d.Hash, raw.At)
	if err != nil {
		return state, err
	}
	return state, tx.Commit(ctx)
}
func (s *Store) Event(ctx context.Context, scope Scope, boot string, e Event) (State, error) {
	tx, err := begin(ctx, s.Pool, scope)
	if err != nil {
		return State{}, err
	}
	defer tx.Rollback(ctx)
	at := time.Now().UTC()
	if err = saveEvent(ctx, tx, scope, boot, e, at); err != nil {
		return State{}, err
	}
	var currentBoot string
	var seq int64
	if err = tx.QueryRow(ctx, `SELECT boot_id,stream_seq FROM frame_nodes WHERE network=$1 AND mode=$2 AND node_id=$3`, scope.Network, scope.Mode, scope.Node).Scan(&currentBoot, &seq); err != nil {
		return State{}, err
	}
	if currentBoot != boot {
		return State{}, errors.New("frame node restarted during subscription")
	}
	if e.Seq > seq+1 {
		if err = incident(ctx, tx, scope, boot, e.Hash, "history_gap", fmt.Sprintf("%d:%d", seq+1, e.Seq-1), at, map[string]any{"first_missing_seq": seq + 1, "last_missing_seq": e.Seq - 1}); err != nil {
			return State{}, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE frame_nodes SET stream_seq=GREATEST(stream_seq,$4) WHERE network=$1 AND mode=$2 AND node_id=$3`, scope.Network, scope.Mode, scope.Node, e.Seq)
	if err != nil {
		return State{}, err
	}
	state, err := s.project(ctx, tx, scope, boot, strings.ToLower(e.Hash), at)
	if err != nil {
		return state, err
	}
	return state, tx.Commit(ctx)
}
func (s *Store) Receipt(ctx context.Context, scope Scope, boot, hash string, p Proof, records []Raw) (State, error) {
	tx, err := begin(ctx, s.Pool, scope)
	if err != nil {
		return State{}, err
	}
	defer tx.Rollback(ctx)
	for _, r := range records {
		if err = saveRaw(ctx, tx, scope, boot, r); err != nil {
			return State{}, err
		}
	}
	body, _ := json.Marshal(p)
	_, err = tx.Exec(ctx, `INSERT INTO frame_receipt_checks(network,mode,node_id,boot_id,tx_hash,checked_at,proof) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(network,mode,node_id,boot_id,tx_hash) DO UPDATE SET checked_at=EXCLUDED.checked_at,proof=EXCLUDED.proof WHERE frame_receipt_checks.checked_at<=EXCLUDED.checked_at`, scope.Network, scope.Mode, scope.Node, boot, hash, p.CheckedAt, body)
	if err != nil {
		return State{}, err
	}
	state, err := s.project(ctx, tx, scope, boot, hash, p.CheckedAt)
	if err != nil {
		return state, err
	}
	return state, tx.Commit(ctx)
}
func (s *Store) project(ctx context.Context, tx pgx.Tx, scope Scope, boot, hash string, now time.Time) (State, error) {
	var a *Admission
	var proof *Proof
	var body []byte
	err := tx.QueryRow(ctx, `SELECT admission FROM frame_admissions WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4 AND tx_hash=$5`, scope.Network, scope.Mode, scope.Node, boot, hash).Scan(&body)
	if err == nil {
		if err = json.Unmarshal(body, &a); err != nil {
			return State{}, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return State{}, err
	}
	rows, err := tx.Query(ctx, `SELECT event FROM frame_events WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4 AND tx_hash=$5 ORDER BY seq`, scope.Network, scope.Mode, scope.Node, boot, hash)
	if err != nil {
		return State{}, err
	}
	events := []Event{}
	for rows.Next() {
		var e Event
		if err = rows.Scan(&body); err != nil {
			rows.Close()
			return State{}, err
		}
		if err = json.Unmarshal(body, &e); err != nil {
			rows.Close()
			return State{}, err
		}
		events = append(events, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return State{}, err
	}
	err = tx.QueryRow(ctx, `SELECT proof FROM frame_receipt_checks WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4 AND tx_hash=$5`, scope.Network, scope.Mode, scope.Node, boot, hash).Scan(&body)
	if err == nil {
		if err = json.Unmarshal(body, &proof); err != nil {
			return State{}, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return State{}, err
	}
	timeout := s.ObservationWindow
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	var first time.Time
	firstErr := tx.QueryRow(ctx, `SELECT first_observed_at FROM frame_transactions WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4 AND tx_hash=$5`, scope.Network, scope.Mode, scope.Node, boot, hash).Scan(&first)
	if firstErr != nil && !errors.Is(firstErr, pgx.ErrNoRows) {
		return State{}, firstErr
	}
	if firstErr != nil {
		first = now
	}
	state := Reduce(scope, boot, hash, a, events, proof, first, now, timeout)
	var currentBoot string
	nodeErr := tx.QueryRow(ctx, `SELECT boot_id FROM frame_nodes WHERE network=$1 AND mode=$2 AND node_id=$3`, scope.Network, scope.Mode, scope.Node).Scan(&currentBoot)
	if nodeErr == nil && currentBoot != boot {
		state.Coverage = unique(state.Coverage, "archived_node_boot")
	}
	if nodeErr != nil && !errors.Is(nodeErr, pgx.ErrNoRows) {
		return State{}, nodeErr
	}
	var gap bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM frame_incidents WHERE network=$1 AND mode=$2 AND node_id=$3 AND boot_id=$4 AND code='history_gap')`, scope.Network, scope.Mode, scope.Node, boot).Scan(&gap); err != nil {
		return State{}, err
	}
	if gap {
		state.Coverage = unique(state.Coverage, "source_event_history_has_gaps")
	}
	body, _ = json.Marshal(state)
	_, err = tx.Exec(ctx, `INSERT INTO frame_transactions(network,mode,node_id,boot_id,tx_hash,first_observed_at,updated_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(network,mode,node_id,boot_id,tx_hash) DO UPDATE SET updated_at=EXCLUDED.updated_at,state=EXCLUDED.state`, scope.Network, scope.Mode, scope.Node, boot, hash, first, now, body)
	if err != nil {
		return state, err
	}
	for _, code := range state.Incidents {
		if err = incident(ctx, tx, scope, boot, hash, code, hash, now, map[string]any{"status": state.Status}); err != nil {
			return state, err
		}
	}
	return state, nil
}
func (s *Store) States(ctx context.Context, scope Scope, hash string, limit int) ([]State, error) {
	rows, err := s.Pool.Query(ctx, `SELECT state FROM frame_transactions WHERE network=$1 AND mode=$2 AND node_id=$3 AND ($4='' OR tx_hash=$4) ORDER BY updated_at DESC,boot_id,tx_hash LIMIT $5`, scope.Network, scope.Mode, scope.Node, hash, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []State{}
	for rows.Next() {
		var body []byte
		var state State
		if err = rows.Scan(&body); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(body, &state); err != nil {
			return nil, err
		}
		items = append(items, state)
	}
	return items, rows.Err()
}
func (s *Store) Incidents(ctx context.Context, scope Scope, limit int) ([]Incident, error) {
	rows, err := s.Pool.Query(ctx, `SELECT boot_id,tx_hash,code,observed_at,detail FROM frame_incidents WHERE network=$1 AND mode=$2 AND node_id=$3 ORDER BY observed_at DESC LIMIT $4`, scope.Network, scope.Mode, scope.Node, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Incident{}
	for rows.Next() {
		i := Incident{Scope: scope}
		if err = rows.Scan(&i.Boot, &i.Hash, &i.Code, &i.At, &i.Detail); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}

type Evidence struct {
	Sequence int64           `json:"sequence"`
	Boot     string          `json:"boot_id"`
	Method   string          `json:"method"`
	First    time.Time       `json:"first_seen"`
	Last     time.Time       `json:"last_seen"`
	Body     json.RawMessage `json:"response"`
}

func (s *Store) Evidence(ctx context.Context, scope Scope, hash string, after int64, limit int) ([]Evidence, error) {
	rows, err := s.Pool.Query(ctx, `SELECT seq,boot_id,method,first_seen,last_seen,body FROM frame_raw WHERE network=$1 AND mode=$2 AND node_id=$3 AND entity=$4 AND seq>$5 ORDER BY seq LIMIT $6`, scope.Network, scope.Mode, scope.Node, hash, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Evidence{}
	for rows.Next() {
		var i Evidence
		if err = rows.Scan(&i.Sequence, &i.Boot, &i.Method, &i.First, &i.Last, &i.Body); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
