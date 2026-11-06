package xray

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/storage"
)

// testPool migrates a fresh schema on TEST_DATABASE_URL (pattern of internal/profiler/store_test.go).
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
	schema := fmt.Sprintf("xray_test_%d", time.Now().UnixNano())
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

func TestStoreUpsertListAndEPBS(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	store := &Store{Pool: pool}
	capture, native := synthetic(t)
	r, err := Compute(Inputs{Capture: capture, Native: native, Metrics: metrics(h("b"), []int64{100, 300, 200}), Source: "follow", Now: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(ctx, r.Block.Hash); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("missing report must be pgx.ErrNoRows", err)
	}
	if has, err := store.Has(ctx, r.Block.Hash); err != nil || has {
		t.Fatal("empty store reports a block", err)
	}
	if err := store.Save(ctx, r); err != nil {
		t.Fatal(err)
	}
	r.Source = "capture"
	if err := store.Save(ctx, r); err != nil {
		t.Fatal("upsert failed", err)
	}
	got, err := store.Get(ctx, r.Block.Hash)
	if err != nil || got.Source != "capture" || *got.Ceilings.Builder.Value != *r.Ceilings.Builder.Value || len(got.Transactions) != 3 {
		t.Fatal("stored report differs", err)
	}
	older := r
	older.Block.Hash, older.Block.Number = h("c"), r.Block.Number-1
	if err := store.Save(ctx, older); err != nil {
		t.Fatal(err)
	}
	briefs, err := store.List(ctx, 10)
	if err != nil || len(briefs) != 2 || briefs[0].BlockHash != r.Block.Hash || briefs[0].Source != "capture" || *briefs[0].BuilderDAGTime != 1.5 {
		t.Fatalf("list %+v %v", briefs, err)
	}
	bad := r
	bad.Schema = "other"
	if store.Save(ctx, bad) == nil {
		t.Fatal("wrong schema saved")
	}
	if e, err := store.EPBS(ctx, r.Block.Hash); err != nil || e != nil {
		t.Fatal("EPBS without PayloadWatch state", e, err)
	}
	for _, mode := range []string{"synthetic", "live"} {
		state, _ := json.Marshal(map[string]any{"payload_hash": r.Block.Hash, "builder_index": "12", "self_build": false, "status": "revealed", "delivery": "on_time", "reveal_latency_ms": 812, "ptc_payload_yes": 300, "ptc_payload_no": 2, "ptc_timely": nil, "canonical": true})
		if _, err := pool.Exec(ctx, `INSERT INTO pw_states(network,mode,source_id,slot,block_root,updated_at,state) VALUES('sepolia',$1,'beacon',32,$2,now(),$3)`, mode, h("f"), state); err != nil {
			t.Fatal(err)
		}
	}
	e, err := store.EPBS(ctx, r.Block.Hash)
	if err != nil || e == nil || e.Source != "payloadwatch" || e.Slot != 32 || e.BuilderIndex != "12" || *e.RevealLatencyMS != 812 || *e.PTCPayloadYes != 300 || e.PTCTimely != nil || !*e.Canonical {
		t.Fatalf("EPBS %+v %v", e, err)
	}
	if id, err := store.LatestProfile(ctx, r.Block.Hash); err != nil || id != "" {
		t.Fatal("phantom profile", id, err)
	}
}
