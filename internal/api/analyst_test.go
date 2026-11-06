package api

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/analyst"
	"rooted/internal/storage"
)

func TestAnalystBriefScope(t *testing.T) {
	s := &Server{Network: "sepolia", Analyst: &analyst.Store{}}
	for _, tc := range []struct {
		method, path, contentType string
		status                    int
	}{
		{"GET", "/api/v1/analyst/briefs", "", 400},
		{"GET", "/api/v1/analyst/briefs?network=mainnet", "", 400},
		{"GET", "/api/v1/analyst/briefs?network=sepolia&limit=0", "", 400},
		{"GET", "/api/v1/analyst/briefs?network=sepolia&limit=101", "", 400},
		{"POST", "/api/v1/analyst/briefs?network=sepolia", "text/plain", 415},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", tc.contentType)
		s.Handler().ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body)
		}
	}
	for _, off := range []*Server{{Network: "sepolia"}, {Network: "hoodi", Analyst: &analyst.Store{}}} {
		w := httptest.NewRecorder()
		off.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/analyst/briefs?network=sepolia", nil))
		if w.Code != 503 {
			t.Fatal("unconfigured analyst store must be 503", w.Code)
		}
	}
}

func TestAnalystBriefRoutes(t *testing.T) {
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
	schema := fmt.Sprintf("analyst_api_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	cfg, _ := pgxpool.ParseConfig(dsn)
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := (&storage.Postgres{Pool: pool}).Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	s := &Server{Network: "sepolia", Analyst: &analyst.Store{Pool: pool}}
	do := func(method, body string) (int, string) {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/v1/analyst/briefs?network=sepolia", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		s.Handler().ServeHTTP(w, req)
		return w.Code, w.Body.String()
	}
	hash := "0x" + strings.Repeat("C", 64)
	valid := func(text string) string {
		return `{"block_hash":"` + hash + `","block_number":12076467,"triggers":["builder_gap","big_block"],"brief":"` + text + `","evidence":[{"id":"E1","kind":"xray"}],"model":"claude-opus-5-5","usd":0.42}`
	}
	for name, body := range map[string]string{
		"not json":      "brief",
		"two objects":   valid("a") + valid("b"),
		"unknown field": `{"block_hash":"` + hash + `","extra":1}`,
		"network":       strings.Replace(valid("a"), `{`, `{"network":"mainnet",`, 1),
		"short hash":    strings.Replace(valid("a"), hash, "0x12", 1),
		"trigger":       strings.Replace(valid("a"), "big_block", "huge_block", 1),
		"empty brief":   valid(""),
		"long brief":    valid(strings.Repeat("x", 8001)),
	} {
		if code, out := do("POST", body); code != 400 {
			t.Fatal(name, code, out)
		}
	}
	if code, out := do("POST", valid(strings.Repeat("x", 70000))); code != 413 {
		t.Fatal("oversized body", code, out)
	}
	if code, out := do("POST", valid("first")); code != 200 || !strings.Contains(out, `"block_hash":"`+strings.ToLower(hash)+`"`) || !strings.Contains(out, `"created_at"`) {
		t.Fatal(code, out)
	}
	if code, out := do("POST", valid("second [E1]")); code != 200 {
		t.Fatal("upsert", code, out)
	}
	code, out := do("GET", "")
	if code != 200 || strings.Count(out, `"block_hash"`) != 1 || !strings.Contains(out, `"brief":"second [E1]"`) || !strings.Contains(out, `"triggers":["builder_gap","big_block"]`) || !strings.Contains(out, `"usd":0.42`) {
		t.Fatal(code, out)
	}
}
