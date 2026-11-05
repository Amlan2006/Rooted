package framemempool

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"rooted/internal/ingest"
	"strings"
	"time"
)

type Submission struct {
	Attempt string `json:"attempt_id"`
	Scope
	Hash     string          `json:"expected_hash"`
	At       time.Time       `json:"submitted_at"`
	Status   string          `json:"submission_status"`
	Response json.RawMessage `json:"response"`
}

func (s *Store) submission(ctx context.Context, i Submission) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO frame_submissions(attempt_id,network,mode,node_id,expected_hash,submitted_at,status,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
 ON CONFLICT(attempt_id) DO UPDATE SET status=EXCLUDED.status,response=EXCLUDED.response`, i.Attempt, i.Network, i.Mode, i.Node, i.Hash, i.At, i.Status, i.Response)
	return err
}
func (s *Store) Submissions(ctx context.Context, scope Scope, limit int) ([]Submission, error) {
	rows, err := s.Pool.Query(ctx, `SELECT attempt_id,expected_hash,submitted_at,status,response FROM frame_submissions WHERE network=$1 AND mode=$2 AND node_id=$3 ORDER BY submitted_at DESC LIMIT $4`, scope.Network, scope.Mode, scope.Node, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Submission{}
	for rows.Next() {
		i := Submission{Scope: scope}
		if err = rows.Scan(&i.Attempt, &i.Hash, &i.At, &i.Status, &i.Response); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
func (c *Collector) Submit(ctx context.Context, transaction json.RawMessage, expected string) (Submission, error) {
	if c.Scope.Mode != "live" || !ingest.ValidRoot(expected) {
		return Submission{}, errors.New("submission requires live devnet scope and expected hash")
	}
	var tx struct {
		ChainID    string            `json:"chainId"`
		Sender     string            `json:"sender"`
		Frames     []Frame           `json:"frames"`
		Signatures []json.RawMessage `json:"signatures"`
	}
	if json.Unmarshal(transaction, &tx) != nil || len(tx.Frames) == 0 || len(tx.Signatures) == 0 {
		return Submission{}, errors.New("expected a signed frame transaction JSON object")
	}
	chain, err := quantity(tx.ChainID)
	if err != nil || chain != c.ChainID {
		return Submission{}, errors.New("signed transaction chain mismatch")
	}
	n, err := c.verify(ctx)
	if err != nil {
		return Submission{}, err
	}
	var id [16]byte
	if _, err = rand.Read(id[:]); err != nil {
		return Submission{}, err
	}
	item := Submission{Attempt: hex.EncodeToString(id[:]), Scope: c.Scope, Hash: strings.ToLower(expected), At: time.Now().UTC(), Status: "submission_unknown", Response: json.RawMessage(`{}`)}
	// Record the attempt before the external call. A crash/transport failure must
	// never be mistaken for rejection or trigger an automatic resubmission.
	if err = c.Store.submission(ctx, item); err != nil {
		return item, err
	}
	var returned string
	raw, sendErr := c.Node.Call(ctx, "eth_sendFrameTransaction", []any{transaction}, &returned)
	if len(raw.Body) > 0 {
		item.Response = raw.Body
	} else {
		item.Response = json.RawMessage(`{"transport":"unavailable_or_response_lost"}`)
	}
	if sendErr == nil {
		item.Status = "submission_acknowledged"
		if !strings.EqualFold(returned, expected) {
			item.Status = "acknowledgment_hash_mismatch"
		}
	} else {
		var re *RPCError
		if errors.As(sendErr, &re) {
			item.Status = "rpc_rejected"
		}
	}
	finish, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = c.Store.submission(finish, item); err != nil {
		return item, err
	}
	if len(raw.Body) > 0 {
		raw.Entity = item.Hash
		if err = c.Store.Raw(finish, c.Scope, n.Info.Boot, raw); err != nil {
			return item, err
		}
	}
	// Admission is independent evidence; an acknowledgment alone changes no
	// transaction state. Best-effort collection is safe to repeat separately.
	_ = c.Fetch(finish, n.Info.Boot, item.Hash)
	return item, nil
}
