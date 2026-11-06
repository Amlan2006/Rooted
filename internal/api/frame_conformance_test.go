package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/framemempool"
	"rooted/internal/storage"
)

func conformanceGet(t *testing.T, s *Server, file, body, query string) (int, map[string]any) {
	t.Helper()
	if body != "" {
		if err := os.WriteFile(file, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("ROOTED_FRAME_CONFORMANCE_FILE", file)
	w := httptest.NewRecorder()
	s.frameConformance(w, httptest.NewRequest("GET", "/api/v1/frames/conformance?"+query, nil))
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return w.Code, out
}

func errorCode(out map[string]any) string {
	e, _ := out["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

func TestFrameConformanceFileBoundaries(t *testing.T) {
	dir := t.TempDir()
	s := &Server{Frames: &framemempool.Store{}, FrameNetwork: "frame-devnet"}
	if code, out := conformanceGet(t, s, filepath.Join(dir, "absent.json"), "", "network=frame-devnet"); code != 404 || errorCode(out) != "not_found" {
		t.Fatalf("absent file: %d %v", code, out)
	}
	if code, out := conformanceGet(t, s, filepath.Join(dir, "absent.json"), "", "network=sepolia"); code != 400 || errorCode(out) != "invalid_network" {
		t.Fatalf("wrong network: %d %v", code, out)
	}
	for name, body := range map[string]string{
		"schema": `{"schema":"rooted-frame-conformance-v0","cases":[]}`,
		"json":   `{"schema":`,
		"cases":  `{"schema":"rooted-frame-conformance-v1","cases":{}}`,
		"case":   `{"schema":"rooted-frame-conformance-v1","cases":[1]}`,
		"large":  `{"schema":"rooted-frame-conformance-v1","cases":[],"pad":"` + strings.Repeat("x", 1<<20) + `"}`,
	} {
		if code, out := conformanceGet(t, s, filepath.Join(dir, name+".json"), body, "network=frame-devnet"); code != 500 || errorCode(out) != "invalid_results" {
			t.Fatalf("%s: %d %v", name, code, out)
		}
	}
	// Cases without a valid hash never touch the archive and get a null status.
	code, out := conformanceGet(t, s, filepath.Join(dir, "ok.json"), `{"schema":"rooted-frame-conformance-v1","run_id":"ab","chain_id":1337,"cases":[{"id":"keys-17","tx_hash":null},{"id":"x","tx_hash":"0x12"}]}`, "network=frame-devnet")
	data, _ := out["data"].(map[string]any)
	cases, _ := data["cases"].([]any)
	if code != 200 || len(cases) != 2 || data["chain_id"] != float64(1337) {
		t.Fatalf("valid file: %d %v", code, out)
	}
	for _, c := range cases {
		if v, present := c.(map[string]any)["archive_status"]; !present || v != nil {
			t.Fatalf("archive_status must be null: %v", c)
		}
	}
}

func TestFrameConformanceJoinsArchiveStatus(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to verify the conformance archive join")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("frame_conformance_api_%d", time.Now().UnixNano())
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
	defer pool.Close()
	if err = (&storage.Postgres{Pool: pool}).Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	frames := &framemempool.Store{Pool: pool}
	scope := framemempool.Scope{Network: "frame-devnet", Mode: "live", Node: "miner"}
	hash := "0x" + strings.Repeat("d", 64)
	at := time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC)
	if _, err = frames.Register(ctx, scope, framemempool.Info{Protocol: 1, ChainID: 1337, Boot: "boot", Oldest: 1, Latest: 1, Capacity: 10}, "0x"+strings.Repeat("a", 64), nil, at); err != nil {
		t.Fatal(err)
	}
	if _, err = frames.Event(ctx, scope, "boot", framemempool.Event{Seq: 1, Hash: hash, Kind: "admitted", At: at.UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	s := &Server{Frames: frames, FrameNetwork: "frame-devnet"}
	body := `{"schema":"rooted-frame-conformance-v1","node":"miner","cases":[{"id":"baseline","tx_hash":"` + hash[:2] + strings.ToUpper(hash[2:]) + `"}]}`
	file := filepath.Join(t.TempDir(), "results.json")
	status := func(query string) any {
		code, out := conformanceGet(t, s, file, body, query)
		if code != 200 {
			t.Fatalf("%d %v", code, out)
		}
		return out["data"].(map[string]any)["cases"].([]any)[0].(map[string]any)["archive_status"]
	}
	if v := status("network=frame-devnet"); v == nil {
		t.Fatal("miner-scoped case missing archive status")
	}
	if v := status("network=frame-devnet&node=gateway"); v != nil {
		t.Fatalf("explicit gateway scope leaked miner state: %v", v)
	}
}
