package profiler

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"rooted/internal/ingest"
)

type Store struct{ Pool *pgxpool.Pool }

func (s *Store) Correlate(ctx context.Context, r *Report) error {
	rows, err := s.Pool.Query(ctx, `SELECT id FROM analysis_runs WHERE network='sepolia' AND mode='live' AND block_hash=$1 ORDER BY last_seen DESC LIMIT 20`, r.BlockHash)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		r.Analysis = append(r.Analysis, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = s.Pool.Query(ctx, `SELECT source_id,jsonb_build_object('network','sepolia','mode','live','payload_hash',$1::text,'block_root',block_root,'slot',slot::text,'delivery',state->'delivery','reveal_latency_ms',state->'reveal_latency_ms','coverage',state->'coverage') FROM pw_states WHERE network='sepolia' AND mode='live' AND state->>'payload_hash'=$1 ORDER BY updated_at DESC LIMIT 20`, r.BlockHash)
	if err != nil {
		return err
	}
	defer rows.Close()
	refs := map[string]string{}
	for rows.Next() {
		var source string
		var raw []byte
		if err := rows.Scan(&source, &raw); err != nil {
			return err
		}
		if refs[source] == "" {
			refs[source] = fmt.Sprintf("payload-source-%d", len(refs)+1)
		}
		var data map[string]any
		if err := json.Unmarshal(raw, &data); err != nil {
			return err
		}
		data["source_ref"] = refs[source]
		encoded, _ := json.Marshal(data)
		r.Payloads = append(r.Payloads, json.RawMessage(encoded))
	}
	return rows.Err()
}
func (s *Store) Save(ctx context.Context, r Report, capture []byte) error {
	digest := sha256.Sum256(capture)
	if !ingest.ValidRoot(r.ID) || !ingest.ValidRoot(r.BlockHash) || r.Network != "sepolia" || r.Mode != "replay" || r.CapturedAt.IsZero() || r.CaptureDigest != hex.EncodeToString(digest[:]) {
		return errors.New("invalid profile identity or capture digest")
	}
	var buffer bytes.Buffer
	zip := gzip.NewWriter(&buffer)
	if _, err := zip.Write(capture); err != nil {
		return err
	}
	if err := zip.Close(); err != nil {
		return err
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO execution_profiles(id,network,mode,block_hash,created_at,result,capture_gzip) VALUES($1,$2,$3,$4,$5,$6,$7)`, r.ID, r.Network, r.Mode, r.BlockHash, r.CapturedAt, raw, buffer.Bytes())
	return err
}
func (s *Store) List(ctx context.Context, id string) ([]Report, error) {
	rows, err := s.Pool.Query(ctx, `SELECT result FROM execution_profiles WHERE network='sepolia' AND mode='replay' AND ($1='' OR id=$1) ORDER BY created_at DESC,id LIMIT 20`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Report{}
	for rows.Next() {
		var raw []byte
		var report Report
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if json.Unmarshal(raw, &report) != nil {
			return nil, errors.New("stored profile schema unavailable")
		}
		result = append(result, report)
	}
	return result, rows.Err()
}
func (s *Store) Capture(ctx context.Context, id string) ([]byte, error) {
	var zipped []byte
	if err := s.Pool.QueryRow(ctx, `SELECT capture_gzip FROM execution_profiles WHERE id=$1 AND network='sepolia' AND mode='replay'`, id).Scan(&zipped); err != nil {
		return nil, err
	}
	reader, err := gzip.NewReader(bytes.NewReader(zipped))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	raw, err := io.ReadAll(io.LimitReader(reader, (32<<20)+1))
	if len(raw) > 32<<20 {
		return nil, errors.New("capture limit exceeded")
	}
	return raw, err
}
