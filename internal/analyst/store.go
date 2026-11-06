package analyst

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/ingest"
)

// Triggers is the fixed anomaly vocabulary of dashboard/lib/analyst/rules.ts.
var Triggers = map[string]bool{"builder_gap": true, "gas_misleads": true, "big_block": true, "commitment": true}

// Brief is one auto-written analyst brief for an anomalous block.
type Brief struct {
	Network     string            `json:"network"`
	BlockHash   string            `json:"block_hash"`
	BlockNumber int64             `json:"block_number"`
	CreatedAt   time.Time         `json:"created_at"`
	Triggers    []string          `json:"triggers"`
	Brief       string            `json:"brief"`
	Evidence    []json.RawMessage `json:"evidence"`
	Model       string            `json:"model"`
	USD         float64           `json:"usd"`
}

// Check reports the first invalid field; the API returns its message as a 400.
func Check(b Brief) error {
	seen := map[string]bool{}
	for _, t := range b.Triggers {
		if !Triggers[t] || seen[t] {
			return errors.New("triggers must be unique values of builder_gap, gas_misleads, big_block, commitment")
		}
		seen[t] = true
	}
	switch {
	case b.Network != "sepolia":
		return errors.New("network must be sepolia")
	case !ingest.ValidRoot(b.BlockHash) || b.BlockHash != strings.ToLower(b.BlockHash):
		return errors.New("block_hash must be a lowercase 32-byte hex hash")
	case b.BlockNumber <= 0:
		return errors.New("block_number must be positive")
	case len(b.Triggers) == 0:
		return errors.New("at least one trigger is required")
	case strings.TrimSpace(b.Brief) == "" || utf8.RuneCountInString(b.Brief) > 8000:
		return errors.New("brief must be 1..8000 characters")
	case strings.TrimSpace(b.Model) == "" || len(b.Model) > 100:
		return errors.New("model must be 1..100 characters")
	case b.USD < 0:
		return errors.New("usd must not be negative")
	}
	return nil
}

type Store struct{ Pool *pgxpool.Pool }

// Save upserts on (network, block_hash); the latest brief of a block wins and is stamped now.
func (s *Store) Save(ctx context.Context, b Brief) (Brief, error) {
	if err := Check(b); err != nil {
		return b, err
	}
	if b.Evidence == nil {
		b.Evidence = []json.RawMessage{}
	}
	err := s.Pool.QueryRow(ctx, `INSERT INTO analyst_briefs(network,block_hash,block_number,triggers,brief,evidence,model,usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT(network,block_hash) DO UPDATE SET block_number=EXCLUDED.block_number,created_at=now(),triggers=EXCLUDED.triggers,brief=EXCLUDED.brief,evidence=EXCLUDED.evidence,model=EXCLUDED.model,usd=EXCLUDED.usd
RETURNING created_at`, b.Network, b.BlockHash, b.BlockNumber, b.Triggers, b.Brief, b.Evidence, b.Model, b.USD).Scan(&b.CreatedAt)
	return b, err
}

// List returns the newest briefs first.
func (s *Store) List(ctx context.Context, limit int) ([]Brief, error) {
	rows, err := s.Pool.Query(ctx, `SELECT network,block_hash,block_number,created_at,triggers,brief,evidence,model,usd::float8 FROM analyst_briefs WHERE network='sepolia' ORDER BY created_at DESC,block_number DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Brief{}
	for rows.Next() {
		var b Brief
		if err := rows.Scan(&b.Network, &b.BlockHash, &b.BlockNumber, &b.CreatedAt, &b.Triggers, &b.Brief, &b.Evidence, &b.Model, &b.USD); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
