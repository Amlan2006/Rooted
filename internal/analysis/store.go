package analysis

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/domain"
	"strconv"
	"time"
)

type Store struct{ Pool *pgxpool.Pool }

func digest(raw []byte) (string, error) {
	if !json.Valid(raw) {
		return "", errors.New("analysis evidence must contain one valid JSON value")
	}
	var value any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := d.Decode(&value); err != nil {
		return "", err
	}
	b, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}
func (s *Store) Save(ctx context.Context, snapshot Snapshot) error {
	r := snapshot.Run
	if r.ID == "" || r.CreatedAt.IsZero() || (r.Mode != "live" && r.Mode != "fork" && r.Mode != "captured" && r.Mode != "synthetic") {
		return errors.New("invalid analysis identity")
	}
	number, err := parseBlockNumber(r.Block.Number)
	if err != nil {
		return err
	}
	body, err := json.Marshal(r)
	if err != nil {
		return err
	}
	semantic := r
	semantic.CreatedAt = time.Time{}
	semantic.Sources = append([]domain.Source{}, r.Sources...)
	for i := range semantic.Sources {
		semantic.Sources[i].FetchedAt = time.Time{}
	}
	versionBody, err := json.Marshal(semantic)
	if err != nil {
		return err
	}
	hash, err := digest(versionBody)
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO analysis_runs(id,network,mode,block_hash,block_number,first_seen,last_seen,result) VALUES($1,$2,$3,$4,$5,$6,$6,$7) ON CONFLICT(id) DO UPDATE SET last_seen=EXCLUDED.last_seen,result=EXCLUDED.result WHERE analysis_runs.last_seen<=EXCLUDED.last_seen`, r.ID, r.Network, r.Mode, r.Block.Hash, strconv.FormatUint(number, 10), r.CreatedAt, body)
	if err != nil {
		return err
	}
	for _, record := range snapshot.Records {
		d, err := digest(record.Body)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO analysis_raw(run_id,kind,origin,digest,body,first_seen,last_seen) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(run_id,kind,origin,digest) DO UPDATE SET last_seen=GREATEST(analysis_raw.last_seen,EXCLUDED.last_seen)`, r.ID, record.Kind, record.Origin, d, record.Body, record.FetchedAt)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO analysis_versions(run_id,digest,result,observed_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, r.ID, hash, body, r.CreatedAt)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func parseBlockNumber(s string) (uint64, error) {
	if len(s) < 3 || s[:2] != "0x" {
		return 0, errors.New("invalid block number")
	}
	return strconv.ParseUint(s[2:], 16, 64)
}
func (s *Store) List(ctx context.Context, network, mode, blockHash, id string, limit int) ([]Run, error) {
	rows, err := s.Pool.Query(ctx, `SELECT result FROM analysis_runs WHERE network=$1 AND mode=$2 AND ($3='' OR block_hash=$3) AND ($4='' OR id=$4) ORDER BY last_seen DESC,id LIMIT $5`, network, mode, blockHash, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Run{}
	for rows.Next() {
		var b []byte
		var r Run
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(b, &r); err != nil {
			return nil, err
		}
		items = append(items, r)
	}
	return items, rows.Err()
}

type Evidence struct {
	Kind   string          `json:"kind"`
	Origin string          `json:"origin"`
	Digest string          `json:"digest"`
	Body   json.RawMessage `json:"response"`
}

func (s *Store) Evidence(ctx context.Context, id string, limit, offset int) ([]Evidence, error) {
	rows, err := s.Pool.Query(ctx, `SELECT kind,origin,digest,body FROM analysis_raw WHERE run_id=$1 ORDER BY kind,origin,digest LIMIT $2 OFFSET $3`, id, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Evidence{}
	for rows.Next() {
		var i Evidence
		if err = rows.Scan(&i.Kind, &i.Origin, &i.Digest, &i.Body); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
