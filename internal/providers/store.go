package providers

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ Pool *pgxpool.Pool }

func (s *Store) Save(ctx context.Context, r Report) error {
	if !ValidHash(r.ID) || !ValidHash(r.BlockHash) || r.Network != "sepolia" || r.Mode != "live" || r.CreatedAt.IsZero() {
		return errors.New("invalid provider comparison identity or scope")
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO provider_comparisons(id,network,block_hash,created_at,result) VALUES($1,$2,$3,$4,$5)`, r.ID, r.Network, r.BlockHash, r.CreatedAt, raw)
	return err
}
func (s *Store) List(ctx context.Context, hash, id string) ([]Report, error) {
	rows, err := s.Pool.Query(ctx, `SELECT result FROM provider_comparisons WHERE network='sepolia' AND ($1='' OR block_hash=$1) AND ($2='' OR id=$2) ORDER BY created_at DESC,id LIMIT 20`, hash, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Report{}
	for rows.Next() {
		var raw []byte
		var r Report
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &r); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}
