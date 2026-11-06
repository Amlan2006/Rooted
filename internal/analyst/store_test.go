package analyst

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/storage"
)

// testPool migrates a fresh schema on TEST_DATABASE_URL (pattern of internal/xray/store_test.go).
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := fmt.Sprintf("analyst_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := (&storage.Postgres{Pool: pool}).Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return pool
}

func brief(c string, n int64) Brief {
	return Brief{Network: "sepolia", BlockHash: "0x" + strings.Repeat(c, 64), BlockNumber: n, Triggers: []string{"builder_gap"}, Brief: "Builder loses parallelism [E1].", Evidence: []json.RawMessage{json.RawMessage(`{"id":"E1","kind":"xray"}`)}, Model: "claude-opus-5-5", USD: 0.12}
}

func TestCheck(t *testing.T) {
	if err := Check(brief("a", 1)); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Brief){
		"network":       func(b *Brief) { b.Network = "mainnet" },
		"short hash":    func(b *Brief) { b.BlockHash = "0x12" },
		"upper hash":    func(b *Brief) { b.BlockHash = "0x" + strings.Repeat("A", 64) },
		"number":        func(b *Brief) { b.BlockNumber = 0 },
		"no triggers":   func(b *Brief) { b.Triggers = nil },
		"unknown":       func(b *Brief) { b.Triggers = []string{"weird"} },
		"duplicate":     func(b *Brief) { b.Triggers = []string{"big_block", "big_block"} },
		"blank brief":   func(b *Brief) { b.Brief = " \n" },
		"long brief":    func(b *Brief) { b.Brief = strings.Repeat("é", 8001) },
		"no model":      func(b *Brief) { b.Model = "" },
		"negative cost": func(b *Brief) { b.USD = -1 },
	} {
		b := brief("a", 1)
		mutate(&b)
		if Check(b) == nil {
			t.Fatal("accepted", name)
		}
	}
	b := brief("a", 1)
	b.Brief, b.Triggers = strings.Repeat("é", 8000), []string{"builder_gap", "gas_misleads", "big_block", "commitment"}
	if err := Check(b); err != nil {
		t.Fatal("8000 characters and every trigger must pass", err)
	}
}

func TestStoreUpsertAndList(t *testing.T) {
	ctx := context.Background()
	store := &Store{Pool: testPool(t)}
	if got, err := store.List(ctx, 10); err != nil || len(got) != 0 {
		t.Fatal("empty store", got, err)
	}
	first := brief("a", 10)
	first.Evidence = nil
	saved, err := store.Save(ctx, first)
	if err != nil || saved.CreatedAt.IsZero() {
		t.Fatal(saved, err)
	}
	if _, err := store.Save(ctx, brief("b", 9)); err != nil {
		t.Fatal(err)
	}
	again := brief("a", 10)
	again.Brief, again.Triggers, again.USD = "Rewritten [E1].", []string{"big_block", "commitment"}, 0.5
	if _, err := store.Save(ctx, again); err != nil {
		t.Fatal("upsert failed", err)
	}
	got, err := store.List(ctx, 10)
	if err != nil || len(got) != 2 {
		t.Fatal(got, err)
	}
	if g := got[0]; g.BlockHash != again.BlockHash || g.Brief != "Rewritten [E1]." || len(g.Triggers) != 2 || g.Triggers[1] != "commitment" || g.USD != 0.5 || len(g.Evidence) != 1 || !strings.Contains(string(g.Evidence[0]), `"E1"`) {
		t.Fatalf("upserted brief is not newest or differs: %+v", g)
	}
	if got, err := store.List(ctx, 1); err != nil || len(got) != 1 {
		t.Fatal("limit ignored", got, err)
	}
	if _, err := store.Save(ctx, Brief{Network: "sepolia"}); err == nil {
		t.Fatal("invalid brief saved")
	}
}
