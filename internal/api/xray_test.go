package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/storage"
	"rooted/internal/uniswap"
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
		{"GET", "/api/v1/xray/uniswap", 400},
		{"GET", "/api/v1/xray/uniswap?network=sepolia&limit=201", 400},
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
	testUniswapRoute(t, store, get)
}

// Stored reports shaped like block 12,076,476 (one v3 pool, 87 labelled edges, none on the critical path), a v4 block
// whose pool is on the critical path, and an older report whose labelled locations were cut from hot_locations.
func testUniswapRoute(t *testing.T, store *xray.Store, get func(string) (int, string)) {
	ctx := context.Background()
	v3, weth, usdc := "0x3289680dd4d6c10bb19b899729cda5eef58aeff1", "0xfff9976782d46cc05630d1f6ebab18b2324d6b14", "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238"
	poolID := "0x" + strings.Repeat("4", 64)
	hot := func(address string, edges int, path bool, protocol, name, pool string, verified bool) xray.Hot {
		h := xray.Hot{Address: address, Field: "storage", Key: "0x" + strings.Repeat("0", 64), Edges: edges, OnCriticalPath: path}
		if name != "" {
			h.Label = &uniswap.Label{Protocol: protocol, Name: name, Pool: pool, Verified: verified}
		}
		return h
	}
	v, now := 9.0, time.Now().UTC()
	report := func(number uint64, total, labelled int, path []int, hots ...xray.Hot) xray.Report {
		r := xray.Report{Schema: xray.Schema, Network: "sepolia", Source: "follow", ComputedAt: now, Block: xray.Block{Number: number, Hash: fmt.Sprintf("0x%064x", number)},
			Edges: xray.Edges{Total: total}, HotLocations: hots, Uniswap: xray.UniswapCounts{LabeledEdges: labelled}}
		if path != nil {
			r.Ceilings.Builder = xray.Ceiling{Value: &v, CriticalPath: path}
		}
		return r
	}
	for _, r := range []xray.Report{
		report(12076308, 3149, 38, nil, hot("0x45a90fd0ef70b1bb5815c9dc9cd62c78f95ded97", 165, false, "", "", "", false)),
		report(12076476, 2751, 87, []int{39, 48, 64, 114, 123, 127, 132, 154, 177},
			hot("0x45a90fd0ef70b1bb5815c9dc9cd62c78f95ded97", 165, false, "", "", "", false),
			hot(usdc, 18, false, "uniswap_v3", "token_balance_of_pool", v3, false),
			hot(v3, 18, false, "uniswap_v3", "pool_slot0", v3, true),
			hot(v3, 18, false, "uniswap_v3", "fee_growth_global0", v3, true),
			hot(weth, 18, false, "uniswap_v3", "token_balance_of_pool", v3, false),
			hot(v3, 12, false, "uniswap_v3", "liquidity", v3, true),
			hot(v3, 3, false, "uniswap_v3", "pool_mapping_or_observation", v3, true)),
		report(12076500, 40, 7, []int{2, 5, 9},
			hot(usdc, 2, false, "uniswap_v4", "token_balance_of_pool_manager", uniswap.PoolManager, false),
			hot(uniswap.PoolManager, 5, true, "uniswap_v4", "pool_slot0", poolID, true)),
	} {
		if err := store.Save(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	code, body := get("/api/v1/xray/uniswap?network=sepolia&limit=2")
	var got struct{ Data xray.UniswapScan }
	if code != 200 || json.Unmarshal([]byte(body), &got) != nil {
		t.Fatal(code, body)
	}
	n9, n3, zero, one := 9, 3, 0, 1
	want := xray.UniswapScan{Reports: 4, Matches: 3, Blocks: []xray.UniswapBlock{
		{BlockNumber: 12076500, BlockHash: fmt.Sprintf("0x%064x", 12076500), UniswapEdges: 7, TotalEdges: 40, CriticalPathLength: &n3, CriticalPathUniswapLocations: &one, Pools: []xray.UniswapPool{
			{Protocol: "uniswap_v4", Pool: poolID, Verified: true, Edges: 5, OnCriticalPath: true, Labels: []string{"pool_slot0"}},
			{Protocol: "uniswap_v4", Pool: uniswap.PoolManager, Edges: 2, Labels: []string{"token_balance_of_pool_manager"}}}},
		{BlockNumber: 12076476, BlockHash: fmt.Sprintf("0x%064x", 12076476), UniswapEdges: 87, TotalEdges: 2751, CriticalPathLength: &n9, CriticalPathUniswapLocations: &zero, Pools: []xray.UniswapPool{
			{Protocol: "uniswap_v3", Pool: v3, Verified: true, Edges: 87, Labels: []string{"token_balance_of_pool", "pool_slot0", "fee_growth_global0", "liquidity", "pool_mapping_or_observation"}}}},
	}}
	if !reflect.DeepEqual(got.Data, want) {
		t.Fatalf("got %s", body)
	}
	if code, body := get("/api/v1/xray/uniswap?network=sepolia"); code != 200 || !strings.Contains(body, `"block_number":12076308,"block_hash":"0x0000000000000000000000000000000000000000000000000000000000b84514","uniswap_edges":38,"total_edges":3149,"unlisted_uniswap_edges":38,"critical_path_length":null,"critical_path_uniswap_locations":null,"pools":[]`) {
		t.Fatal("older report without labelled hot locations", code, body)
	}
}
