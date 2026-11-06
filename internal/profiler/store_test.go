package profiler

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"os"
	"rooted/internal/storage"
	"testing"
	"time"
)

func TestImmutableProfileCaptureAndExactCorrelationScope(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("profiler_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	repository := &storage.Postgres{Pool: pool}
	if err := repository.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := repository.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open("../../demo/profiler/replay-input.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	reader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	capture, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	r := profile(t)
	r.Analysis = []string{}
	r.Payloads = []json.RawMessage{}
	// A matching payload from another observation mode must not be linked.
	for _, mode := range []string{"live", "synthetic"} {
		state, _ := json.Marshal(map[string]any{"payload_hash": r.BlockHash, "delivery": "revealed"})
		_, err := pool.Exec(ctx, `INSERT INTO pw_states(network,mode,source_id,slot,block_root,updated_at,state) VALUES('sepolia',$1,'private-operator',1,$2,now(),$3)`, mode, r.BlockHash, state)
		if err != nil {
			t.Fatal(err)
		}
	}
	store := &Store{Pool: pool}
	if err := store.Correlate(ctx, &r); err != nil {
		t.Fatal(err)
	}
	if len(r.Payloads) != 1 {
		t.Fatal("mode scope leaked")
	}
	if string(r.Payloads[0]) == "" {
		t.Fatal("missing correlation evidence")
	}
	if err := store.Save(ctx, r, capture); err != nil {
		t.Fatal(err)
	}
	if store.Save(ctx, r, capture) == nil {
		t.Fatal("saved profile overwritten")
	}
	got, err := store.Capture(ctx, r.ID)
	if err != nil || string(got) != string(capture) {
		t.Fatal("captured state not reproducible", err)
	}
	runs, err := store.List(ctx, r.ID)
	if err != nil || len(runs) != 1 || runs[0].CaptureDigest != r.CaptureDigest {
		t.Fatal("durability failure", err)
	}
	bad := r
	bad.Mode = "live"
	if store.Save(ctx, bad, capture) == nil {
		t.Fatal("live timing claim accepted")
	}
	if store.Save(ctx, r, []byte("changed")) == nil {
		t.Fatal("changed capture accepted")
	}
}
