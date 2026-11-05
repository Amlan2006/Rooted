package framemempool

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
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
	schema := fmt.Sprintf("phase4_test_%d", time.Now().UnixNano())
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
	return &Store{Pool: pool, ObservationWindow: time.Minute}
}
func fixture(t *testing.T, path string) json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", path))
	if err != nil {
		t.Fatal(err)
	}
	var r struct {
		Body string `json:"body"`
	}
	if err = json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	return json.RawMessage(r.Body)
}
func testInfo() Info {
	return Info{Protocol: 1, ChainID: 1337, Boot: "boot-one", Oldest: 1, Latest: 5, Capacity: 10000}
}
func TestDurableDetailDedupeAndScope(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	info := testInfo()
	if _, err := s.Register(ctx, testScope, info, testHash, nil, stamp); err != nil {
		t.Fatal(err)
	}
	raw := fixture(t, "demo/phase1/reference/frame-probe/existing_detail.json")
	var env struct {
		Result Detail `json:"result"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	d := env.Result
	for i := 0; i < 2; i++ {
		if _, err := s.Detail(ctx, testScope, info.Boot, d, Raw{Method: "skandha_explorer_getTransaction", Entity: d.Hash, Body: raw, At: stamp.Add(time.Duration(i) * time.Second)}); err != nil {
			t.Fatal(err)
		}
	}
	var events, records int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM frame_events").Scan(&events); err != nil || events != len(d.Events) {
		t.Fatalf("event dedupe %d %v", events, err)
	}
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM frame_raw").Scan(&records); err != nil || records != 1 {
		t.Fatalf("raw dedupe %d %v", records, err)
	}
	restored := &Store{Pool: s.Pool}
	items, err := restored.States(ctx, testScope, d.Hash, 50)
	if err != nil || len(items) != 1 || !items[0].AdmissionConfirmed || items[0].InclusionConfirmed || items[0].Status != "included_reported" {
		t.Fatalf("bad durable state %+v %v", items, err)
	}
	other := testScope
	other.Mode = "live"
	items, err = restored.States(ctx, other, d.Hash, 50)
	if err != nil || len(items) != 0 {
		t.Fatal("synthetic leaked into live")
	}
	// Source clocks and event sequence are scoped to one node boot.
	newInfo := info
	newInfo.Boot = "boot-two"
	newInfo.Latest = 1
	if _, err = s.Register(ctx, testScope, newInfo, testHash, nil, stamp.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	event := Event{Seq: 1, Hash: d.Hash, Kind: "rejected", At: stamp.UnixMilli()}
	if _, err = s.Event(ctx, testScope, newInfo.Boot, event); err != nil {
		t.Fatal(err)
	}
	items, err = s.States(ctx, testScope, d.Hash, 50)
	if err != nil || len(items) != 2 {
		t.Fatal("restart erased prior evidence")
	}
	incidents, err := s.Incidents(ctx, testScope, 50)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, i := range incidents {
		if i.Code == "node_restarted" {
			found = true
		}
	}
	if !found {
		t.Fatal("restart not recorded")
	}
	event.Kind = "included"
	if _, err = s.Event(ctx, testScope, newInfo.Boot, event); err == nil {
		t.Fatal("sequence collision accepted")
	}
}
func TestGapsAndCanonicalReorg(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	info := testInfo()
	info.Oldest = 4
	if _, err := s.Register(ctx, testScope, info, testHash, nil, stamp); err != nil {
		t.Fatal(err)
	}
	n, err := s.Node(ctx, testScope)
	if err != nil || n.Seq != 3 {
		t.Fatalf("gap resume point %+v %v", n, err)
	}
	event := Event{Seq: 4, Hash: testHash, Kind: "included", At: stamp.UnixMilli()}
	if _, err = s.Event(ctx, testScope, info.Boot, event); err != nil {
		t.Fatal(err)
	}
	proof := Proof{CheckedAt: stamp, Receipt: &Receipt{Hash: testHash, Status: "0x1"}, IdentityMatched: true, Canonical: truth(true)}
	state, err := s.Receipt(ctx, testScope, info.Boot, testHash, proof, nil)
	if err != nil || !state.InclusionConfirmed {
		t.Fatal("canonical receipt missing")
	}
	proof.CheckedAt = stamp.Add(time.Second)
	proof.Canonical = truth(false)
	state, err = s.Receipt(ctx, testScope, info.Boot, testHash, proof, nil)
	if err != nil || state.Status != "reorged" || state.InclusionConfirmed {
		t.Fatalf("reorg not recorded %+v %v", state, err)
	}
	proof.CheckedAt = stamp
	proof.Canonical = truth(true)
	state, err = s.Receipt(ctx, testScope, info.Boot, testHash, proof, nil)
	if err != nil || state.Status != "reorged" {
		t.Fatal("stale receipt restored orphan")
	}
	proof.CheckedAt = stamp.Add(2 * time.Second)
	proof.Canonical = truth(true)
	state, err = s.Receipt(ctx, testScope, info.Boot, testHash, proof, nil)
	if err != nil || !state.InclusionConfirmed {
		t.Fatal("canonical recovery failed")
	}
	incidents, err := s.Incidents(ctx, testScope, 50)
	if err != nil {
		t.Fatal(err)
	}
	gap := false
	orphan := false
	for _, i := range incidents {
		gap = gap || i.Code == "history_gap"
		orphan = orphan || i.Code == "receipt_orphaned"
	}
	if !gap || !orphan {
		t.Fatalf("incident evidence missing %+v", incidents)
	}
	wrong := info
	wrong.ChainID = 1
	if _, err = s.Register(ctx, testScope, wrong, testHash, nil, stamp.Add(time.Hour)); err == nil {
		t.Fatal("chain identity changed silently")
	}
}

func TestConcurrentMetadataDoesNotRegress(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	info := testInfo()
	info.Version = "new"
	if _, err := s.Register(ctx, testScope, info, testHash, nil, stamp.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	older := info
	older.Version = "old"
	older.Latest = 4
	node, err := s.Register(ctx, testScope, older, testHash, nil, stamp)
	if err != nil || node.Info.Version != "new" || node.Info.Latest != 5 {
		t.Fatalf("fresh metadata overwritten %+v %v", node, err)
	}
	older.Boot = "old-boot"
	if _, err = s.Register(ctx, testScope, older, testHash, nil, stamp); err == nil {
		t.Fatal("stale boot reactivated")
	}
}
