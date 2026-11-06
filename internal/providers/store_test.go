package providers

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"rooted/internal/storage"
	"testing"
	"time"
)

func TestComparisonStorePreservesRechecksAndScope(t *testing.T) {
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
	schema := fmt.Sprintf("providers_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
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
	c, close := fixture(t, "")
	defer close()
	first, _ := c.Compare(ctx, hash("a"))
	second, _ := c.Compare(ctx, hash("a"))
	second.CreatedAt = first.CreatedAt.Add(time.Second)
	store := &Store{Pool: pool}
	for _, r := range []Report{first, second} {
		if err := store.Save(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Save(ctx, first); err == nil {
		t.Fatal("saved comparisons must be immutable")
	}
	rows, err := store.List(ctx, hash("a"), "")
	if err != nil || len(rows) != 2 || rows[0].ID != second.ID {
		t.Fatalf("saved rechecks: %v %v", rows, err)
	}
	rows, err = (&Store{Pool: pool}).List(ctx, "", first.ID)
	if err != nil || len(rows) != 1 || rows[0].Status != first.Status {
		t.Fatal("durable identity lookup failed", err)
	}
	rows, err = store.List(ctx, hash("b"), "")
	if err != nil || len(rows) != 0 {
		t.Fatal("block scope leaked", err)
	}
}
