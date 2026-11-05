package analysis

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"rooted/internal/domain"
	"rooted/internal/storage"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
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
	schema := fmt.Sprintf("phase5_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	p := &storage.Postgres{Pool: pool}
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = p.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return &Store{Pool: pool}
}
func TestStoreDurabilityScopeAndIdempotency(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	r := Run{ID: testBlock, Network: "sepolia", Mode: "live", Block: Block{Hash: testBlock, Number: "0x2"}, CreatedAt: now, Sources: []domain.Source{{Kind: "test", Origin: "https://synthetic.invalid", FetchedAt: now}}}
	raw := domain.RawRecord{Source: r.Sources[0], Body: json.RawMessage(`{"result":12345678901234567890}`)}
	for i := 0; i < 2; i++ {
		r.CreatedAt = now.Add(time.Duration(i) * time.Second)
		r.Sources[0].FetchedAt = r.CreatedAt
		raw.FetchedAt = r.CreatedAt
		if err := s.Save(ctx, Snapshot{Run: r, Records: []domain.RawRecord{raw}}); err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"analysis_runs", "analysis_raw", "analysis_versions"} {
		var n int
		if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil || n != 1 {
			t.Fatalf("%s dedupe: %d %v", table, n, err)
		}
	}
	restored := &Store{Pool: s.Pool}
	rows, err := restored.List(ctx, "sepolia", "live", testBlock, r.ID, 1)
	if err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
	for _, scope := range [][2]string{{"sepolia", "fork"}, {"sepolia-fork", "live"}, {"mainnet", "live"}} {
		rows, err := restored.List(ctx, scope[0], scope[1], "", r.ID, 1)
		if err != nil || len(rows) != 0 {
			t.Fatal("scope leak", err)
		}
	}
	evidence, err := restored.Evidence(ctx, r.ID, 10, 0)
	if err != nil || len(evidence) != 1 {
		t.Fatal(evidence, err)
	}
	r.Coverage = []string{"new evidence"}
	if err = s.Save(ctx, Snapshot{Run: r}); err != nil {
		t.Fatal(err)
	}
	var n int
	s.Pool.QueryRow(ctx, "SELECT count(*) FROM analysis_versions").Scan(&n)
	if n != 2 {
		t.Fatal("did not retain changed evidence")
	}
}
