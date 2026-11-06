package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/domain"
)

func TestPostgresPersistence(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("phase2_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE") }()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	p := &Postgres{Pool: pool}
	defer func() { p.Close() }()
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = p.Migrate(ctx); err != nil {
		t.Fatal("migration not repeatable", err)
	}
	var migrations int
	if err = p.Pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&migrations); err != nil || migrations != 7 {
		t.Fatalf("unexpected migration state: count=%d error=%v", migrations, err)
	}
	stamp := time.Now().UTC()
	root := "0x" + strings.Repeat("a", 64)
	snapshot := domain.Snapshot{Observation: domain.Observation{Network: "sepolia", Slot: 42, BlockRoot: root, FetchedAt: stamp, Status: "observed"}, Records: []domain.RawRecord{{Source: domain.Source{Kind: "test", Origin: "https://example.org", FetchedAt: stamp}, Body: json.RawMessage(`{"x":1,"large":18446744073709551615}`)}}}
	if err = p.Save(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Observation.FetchedAt = stamp.Add(time.Second)
	snapshot.Records[0].Body = json.RawMessage(`{ "large": 18446744073709551615, "x": 1 }`)
	if err = p.Save(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = p.Pool.QueryRow(ctx, "SELECT count(*) FROM raw_observations").Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate raw evidence: count=%d err=%v", count, err)
	}
	// An older concurrent fetch must not replace a later successful snapshot.
	snapshot.Observation.FetchedAt = stamp.Add(-time.Second)
	snapshot.Observation.Status = "pending"
	if err = p.Save(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	latest, err := p.List(ctx, "sepolia", 42, root)
	if err != nil || len(latest) != 1 || latest[0].Status != "observed" || !latest[0].FetchedAt.Equal(stamp.Add(time.Second)) {
		t.Fatalf("stale fetch overwrote current snapshot: %+v %v", latest, err)
	}
	// Even the first valid raw record must roll back if a later one is malformed.
	invalid := snapshot
	invalid.Observation.BlockRoot = "0x" + strings.Repeat("c", 64)
	invalid.Records = append(append([]domain.RawRecord{}, snapshot.Records...), domain.RawRecord{Source: snapshot.Records[0].Source, Body: json.RawMessage(`{"ok":1} {"extra":2}`)})
	if err = p.Save(ctx, invalid); err == nil {
		t.Fatal("accepted multiple JSON values as raw evidence")
	}
	rollback, err := p.List(ctx, "sepolia", 42, invalid.Observation.BlockRoot)
	if err != nil || len(rollback) != 0 {
		t.Fatalf("partial snapshot escaped transaction rollback: %+v %v", rollback, err)
	}
	if err = p.Pool.QueryRow(ctx, "SELECT count(*) FROM raw_observations").Scan(&count); err != nil || count != 1 {
		t.Fatalf("raw evidence escaped rollback: %d %v", count, err)
	}
	// Closing every connection and reopening tests durable storage, not a memory cache.
	p.Close()
	pool, err = pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	p = &Postgres{Pool: pool}
	items, err := p.List(ctx, "sepolia", 42, "")
	if err != nil || len(items) != 1 {
		t.Fatalf("restart persistence: %v %+v", err, items)
	}
	snapshot.Observation.Network = "other-network"
	if err = p.Save(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot.Observation.Network = "sepolia"
	snapshot.Observation.BlockRoot = "0x" + strings.Repeat("b", 64)
	if err = p.Save(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	items, err = p.List(ctx, "sepolia", 42, "")
	if err != nil || len(items) != 2 {
		t.Fatalf("fork roots lost: %v %d", err, len(items))
	}
	items, err = p.List(ctx, "other-network", 42, root)
	if err != nil || len(items) != 1 {
		t.Fatalf("network isolation failed: %v", err)
	}
}
