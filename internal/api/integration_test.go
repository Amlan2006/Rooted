package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/ingest"
	"rooted/internal/remote"
	"rooted/internal/storage"
)

type recordedTransport func(*http.Request) (*http.Response, error)

func (f recordedTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRecordedSlotPostgresRoundTrip(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to verify recorded ingestion through PostgreSQL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("rooted_phase2_api_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE") }()
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	open := func() *storage.Postgres {
		t.Helper()
		pool, err := pgxpool.NewWithConfig(ctx, config)
		if err != nil {
			t.Fatal(err)
		}
		return &storage.Postgres{Pool: pool}
	}
	repo := open()
	defer func() { repo.Close() }()
	if err = repo.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	load := func(name string) []byte {
		t.Helper()
		body, err := os.ReadFile(filepath.Join("..", "ingest", "testdata", name+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var record struct {
			Body string `json:"body"`
		}
		if err = json.Unmarshal(body, &record); err != nil {
			t.Fatal(err)
		}
		return []byte(record.Body)
	}
	// The slot and root come from the ingest fixtures, so a recapture needs no edit here.
	var block, envelope struct {
		Data struct {
			Message struct {
				Slot string `json:"slot"`
				Root string `json:"beacon_block_root"`
			} `json:"message"`
		} `json:"data"`
	}
	if err = json.Unmarshal(load("beacon_block"), &block); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(load("matched_envelope"), &envelope); err != nil {
		t.Fatal(err)
	}
	slot, root := block.Data.Message.Slot, envelope.Data.Message.Root
	if slot == "" || root == "" {
		t.Fatal("ingest fixtures lack a block slot or envelope beacon_block_root")
	}
	responses := map[string][]byte{
		"/eth/v1/beacon/genesis":                             load("beacon_genesis"),
		"/eth/v1/beacon/headers/" + slot:                     []byte(`{"data":{"root":"` + root + `","canonical":true,"header":{"message":{"slot":"` + slot + `"}}}}`),
		"/eth/v2/beacon/blocks/" + root:                      load("beacon_block"),
		"/eth/v1/beacon/execution_payload_envelopes/" + root: load("matched_envelope"),
	}
	client := remote.NewWithHTTPClient("http://recorded.invalid", &http.Client{Transport: recordedTransport(func(r *http.Request) (*http.Response, error) {
		w := httptest.NewRecorder()
		if r.Method == http.MethodPost {
			var request struct {
				Method string `json:"method"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				return nil, err
			}
			switch request.Method {
			case "eth_chainId":
				_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0xaa36a7"}`))
			case "eth_getBlockByHash":
				_, _ = w.Write(load("matched_execution_block"))
			default:
				t.Fatalf("unexpected RPC method %s", request.Method)
			}
		} else if body, ok := responses[r.URL.Path]; ok {
			_, _ = w.Write(body)
		} else {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		return w.Result(), nil
	})})
	collector := &ingest.Collector{Beacon: client, Execution: client, Network: "sepolia-recorded", ChainID: "11155111", GenesisRoot: "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078"}
	server := &Server{Repository: repo, Collector: collector, Network: "sepolia-recorded"}
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/slots/"+slot+"/ingest?network=sepolia-recorded", nil).WithContext(ctx))
		if w.Code != 200 {
			t.Fatalf("ingestion failed: %d %s", w.Code, w.Body)
		}
	}
	var observations, raw int
	if err = repo.Pool.QueryRow(ctx, "SELECT count(*) FROM observations").Scan(&observations); err != nil {
		t.Fatal(err)
	}
	if err = repo.Pool.QueryRow(ctx, "SELECT count(*) FROM raw_observations").Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if observations != 1 || raw != 6 {
		t.Fatalf("duplicate ingestion: observations=%d raw=%d", observations, raw)
	}
	read := func() []byte {
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/slots/"+slot+"?network=sepolia-recorded", nil).WithContext(ctx))
		if w.Code != 200 {
			t.Fatalf("read failed: %d %s", w.Code, w.Body)
		}
		var response ObservationResponse
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Data.Status != "observed" || !response.Data.IdentifiersMatched || response.Data.RevealLatencyMS != nil || response.Data.ExecutionValid != nil {
			t.Fatalf("invalid evidence semantics: %+v", response.Data)
		}
		return w.Body.Bytes()
	}
	before := string(read())
	repo.Close()
	repo = open()
	server.Repository = repo
	if after := string(read()); after != before {
		t.Fatal("stored response changed after closing and reopening every application database connection")
	}
}
