package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/domain"
	"rooted/migrations"
)

type Repository interface {
	Save(context.Context, domain.Snapshot) error
	List(context.Context, string, uint64, string) ([]domain.Observation, error)
	Ping(context.Context) error
}
type Postgres struct{ Pool *pgxpool.Pool }

func Open(ctx context.Context, databaseURL string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Postgres{Pool: pool}, nil
}
func (p *Postgres) Close()                         { p.Pool.Close() }
func (p *Postgres) Ping(ctx context.Context) error { return p.Pool.Ping(ctx) }

func (p *Postgres) Migrate(ctx context.Context) error {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(71624002)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)"); err != nil {
		return err
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		return err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })
	for _, file := range files {
		var version int
		if _, err := fmt.Sscanf(file.Name(), "%d_", &version); err != nil {
			return fmt.Errorf("invalid migration name %s", file.Name())
		}
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", version).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, readErr := migrations.Files.ReadFile(file.Name())
		if readErr != nil {
			return readErr
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", version); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (p *Postgres) Save(ctx context.Context, snapshot domain.Snapshot) error {
	o := snapshot.Observation
	body, err := json.Marshal(o)
	if err != nil {
		return err
	}
	slot := strconv.FormatUint(o.Slot, 10)
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO observations(network,slot,block_root,fetched_at,observation) VALUES($1,$2,$3,$4,$5)
ON CONFLICT(network,slot,block_root) DO UPDATE SET fetched_at=EXCLUDED.fetched_at, observation=EXCLUDED.observation
WHERE observations.fetched_at <= EXCLUDED.fetched_at`, o.Network, slot, o.BlockRoot, o.FetchedAt, body)
	if err != nil {
		return err
	}
	for _, r := range snapshot.Records {
		// Canonical JSON removes insignificant formatting differences in raw evidence.
		if !json.Valid(r.Body) {
			return fmt.Errorf("raw evidence is not a single valid JSON value")
		}
		var value any
		decoder := json.NewDecoder(bytes.NewReader(r.Body))
		decoder.UseNumber()
		if err = decoder.Decode(&value); err != nil {
			return err
		}
		canonical, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			return marshalErr
		}
		digest := sha256.Sum256(canonical)
		_, err = tx.Exec(ctx, `INSERT INTO raw_observations(network,slot,block_root,kind,origin,body_sha256,first_fetched_at,last_fetched_at,body)
VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8)
ON CONFLICT(network,slot,block_root,kind,origin,body_sha256) DO UPDATE
SET first_fetched_at=LEAST(raw_observations.first_fetched_at,EXCLUDED.first_fetched_at),
last_fetched_at=GREATEST(raw_observations.last_fetched_at,EXCLUDED.last_fetched_at)`, o.Network, slot, o.BlockRoot, r.Kind, r.Origin, hex.EncodeToString(digest[:]), r.FetchedAt, canonical)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (p *Postgres) List(ctx context.Context, network string, slot uint64, root string) ([]domain.Observation, error) {
	rows, err := p.Pool.Query(ctx, `SELECT observation FROM observations WHERE network=$1 AND slot=$2 AND ($3='' OR block_root=$3) ORDER BY block_root`, network, strconv.FormatUint(slot, 10), root)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []domain.Observation{}
	for rows.Next() {
		var body []byte
		if err := rows.Scan(&body); err != nil {
			return nil, err
		}
		var o domain.Observation
		if err := json.Unmarshal(body, &o); err != nil {
			return nil, fmt.Errorf("decode stored observation: %w", err)
		}
		result = append(result, o)
	}
	return result, rows.Err()
}
