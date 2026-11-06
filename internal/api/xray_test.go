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
	"rooted/internal/storage"
	"rooted/internal/xray"
)

func TestXrayScopeBoundaries(t *testing.T) {
	hash := "0x" + strings.Repeat("a", 64)
	s := &Server{Network: "sepolia", Xray: &xray.Store{}, XrayEngine: &xray.Engine{}, XrayGate: make(chan struct{}, 1)}
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/api/v1/xray/blocks", 400},
		{"GET", "/api/v1/xray/blocks?network=mainnet", 400},
		{"GET", "/api/v1/xray/blocks/0x12?network=sepolia", 400},
		{"GET", "/api/v1/xray/blocks?network=sepolia&limit=0", 400},
		{"GET", "/api/v1/xray/blocks?network=sepolia&limit=201", 400},
		{"GET", "/api/v1/xray/summary?network=sepolia&limit=10001", 400},
		{"POST", "/api/v1/xray/blocks/latest?network=sepolia", 400},
	} {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body)
		}
	}
	s.XrayGate <- struct{}{}
	w := httptest.NewRecorder()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/xray/blocks/"+hash+"?network=sepolia", nil).WithContext(ctx))
	if w.Code != 429 || !strings.Contains(w.Body.String(), `"busy"`) {
		t.Fatal("replay gate not shared", w.Code, w.Body)
	}
	for _, off := range []*Server{{Network: "sepolia"}, {Network: "hoodi", Xray: &xray.Store{}}, {Network: "sepolia", Xray: &xray.Store{}}} {
		path := "/api/v1/xray/blocks?network=sepolia"
		method := "GET"
		if off.Xray != nil && off.Network == "sepolia" {
			method, path = "POST", "/api/v1/xray/blocks/"+hash+"?network=sepolia"
		}
		w := httptest.NewRecorder()
		off.Handler().ServeHTTP(w, httptest.NewRequest(method, path, nil))
		if w.Code != 503 {
			t.Fatal("unconfigured X-ray must be 503", method, w.Code)
		}
	}
}

func TestXrayStoredRoutes(t *testing.T) {
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
	schema := fmt.Sprintf("xray_api_test_%d", time.Now().UnixNano())
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
	store := &xray.Store{Pool: pool}
	s := &Server{Network: "sepolia", Xray: store}
	hash := "0x" + strings.Repeat("b", 64)
	get := func(path string) (int, string) {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w.Code, w.Body.String()
	}
	if code, body := get("/api/v1/xray/blocks/" + hash + "?network=sepolia"); code != 404 || !strings.Contains(body, "POST to compute") {
		t.Fatal(code, body)
	}
	if code, body := get("/api/v1/xray/summary?network=sepolia"); code != 200 || !strings.Contains(body, `"blocks":0`) {
		t.Fatal(code, body)
	}
	v := 2.5
	r := xray.Report{Schema: xray.Schema, Network: "sepolia", Source: "live", ComputedAt: time.Now().UTC(), Block: xray.Block{Number: 7, Hash: hash, TransactionCount: 1}, Ceilings: xray.CeilingSet{Gas: xray.Ceiling{Model: "validator_bal", Weight: "gas", Value: &v}}}
	if err := store.Save(ctx, r); err != nil {
		t.Fatal(err)
	}
	if code, body := get("/api/v1/xray/blocks/" + hash[2:] + "?network=sepolia"); code != 400 {
		t.Fatal("unprefixed hash accepted", code, body)
	}
	if code, body := get("/api/v1/xray/blocks/" + hash + "?network=sepolia"); code != 200 || !strings.Contains(body, `"schema":"rooted-xray-v1"`) {
		t.Fatal(code, body)
	}
	if code, body := get("/api/v1/xray/blocks?network=sepolia&limit=1"); code != 200 || !strings.Contains(body, `"gas_weighted":2.5`) {
		t.Fatal(code, body)
	}
	if code, body := get("/api/v1/xray/summary?network=sepolia"); code != 200 || !strings.Contains(body, `"blocks":1`) {
		t.Fatal(code, body)
	}
}
