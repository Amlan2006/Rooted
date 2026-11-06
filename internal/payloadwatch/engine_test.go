package payloadwatch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"rooted/internal/storage"
	"strings"
	"testing"
	"time"
)

func testEngine(t *testing.T) *Engine {
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
	schema := fmt.Sprintf("phase3_test_%d", time.Now().UnixNano())
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
	repo := &storage.Postgres{Pool: pool}
	if err = repo.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err = repo.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return &Engine{Pool: pool, Policy: testPolicy}
}
func TestJournalRestartReorgAndCounters(t *testing.T) {
	e := testEngine(t)
	ctx := context.Background()
	session := Session{ID: "s", Start: testAt, Through: testAt.Add(10 * time.Second), Closed: true}
	if err := e.Session(ctx, "sepolia", "synthetic", "test", session); err != nil {
		t.Fatal(err)
	}
	events := healthyEvidence()
	for i := len(events) - 1; i >= 0; i-- {
		if _, _, err := e.Apply(ctx, events[i]); err != nil {
			t.Fatal(err)
		}
	}
	before, err := e.Metrics(ctx, "sepolia", "synthetic", "test")
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		event.ObservedAt = event.ObservedAt.Add(time.Hour)
		if _, inserted, err := e.Apply(ctx, event); err != nil || inserted {
			t.Fatalf("duplicate counted: %v %v", inserted, err)
		}
	}
	restart := &Engine{Pool: e.Pool, Policy: testPolicy}
	after, err := restart.Metrics(ctx, "sepolia", "synthetic", "test")
	if err != nil || before != after {
		t.Fatalf("metrics changed on duplicate/restart: %v\n%s", err, after)
	}
	states, err := restart.States(ctx, "sepolia", "synthetic", "test", nil, "", 50)
	if err != nil || len(states) != 1 || states[0].Status != "healthy" || *states[0].RevealLatencyMS != 1000 {
		t.Fatalf("state lost: %+v %v", states, err)
	}
	stats, err := e.Builders(ctx, "sepolia", "synthetic", "test", "", testAt.Add(-time.Second))
	if err != nil || len(stats) != 1 || stats[0].Healthy != 1 || stats[0].Timed != 1 || *stats[0].P95 != 1000 {
		t.Fatalf("bad builder stats %+v %v", stats, err)
	}
	replacement := selected(1, true)
	replacement.Root = "0x" + strings.Repeat("c", 64)
	replacement.Snapshot.BlockRoot = replacement.Root
	if _, _, err = e.Apply(ctx, replacement); err != nil {
		t.Fatal(err)
	}
	if err = e.Reconcile(ctx, "sepolia", "synthetic", "test", 1, replacement.Root, testAt.Add(20*time.Second)); err != nil {
		t.Fatal(err)
	}
	stats, err = e.Builders(ctx, "sepolia", "synthetic", "test", "", testAt.Add(-time.Second))
	if err != nil || len(stats) != 1 || stats[0].Observations != 1 || stats[0].Healthy != 0 {
		t.Fatalf("orphan in canonical aggregate %+v %v", stats, err)
	}
	live, err := e.States(ctx, "sepolia", "live", "test", nil, "", 50)
	if err != nil || len(live) != 0 {
		t.Fatal("synthetic leaked into live")
	}
	// A second source cannot reuse the first source's receipt coverage.
	other := selected(1, true)
	other.SourceID = "other"
	if _, _, err = e.Apply(ctx, other); err != nil {
		t.Fatal(err)
	}
	entries, err := e.Events(ctx, "sepolia", "synthetic", "test", 0, nil, 200)
	if err != nil {
		t.Fatal(err)
	}
	collision := entries[0].Event
	collision.Kind = "payload_seen"
	collision.PayloadHash = "0x" + strings.Repeat("f", 64)
	collision.Builder = "7"
	if _, _, err = e.Apply(ctx, collision); err == nil {
		t.Fatal("reused event ID accepted different evidence")
	}
	tail, err := e.Events(ctx, "sepolia", "synthetic", "test", entries[len(entries)-1].Sequence, nil, 200)
	if err != nil || len(tail) != 0 {
		t.Fatal("resume cursor duplicated events")
	}
}
func TestRefreshOutageAndAlertResolution(t *testing.T) {
	e := testEngine(t)
	ctx := context.Background()
	session := Session{ID: "s", Start: testAt, Through: testAt.Add(time.Second)}
	if err := e.Session(ctx, "sepolia", "synthetic", "test", session); err != nil {
		t.Fatal(err)
	}
	for _, event := range []Event{selected(1, false), evidence(1, "block_seen", 0)} {
		if _, _, err := e.Apply(ctx, event); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.Refresh(ctx, "sepolia", "synthetic", "test", testAt.Add(20*time.Second)); err != nil {
		t.Fatal(err)
	}
	alerts, err := e.Alerts(ctx, "sepolia", "synthetic", "test", 20)
	if err != nil || len(alerts) != 0 {
		t.Fatal("outage blamed on builder")
	}
	session.Through = testAt.Add(10 * time.Second)
	if err = e.Session(ctx, "sepolia", "synthetic", "test", session); err != nil {
		t.Fatal(err)
	}
	if err = e.Refresh(ctx, "sepolia", "synthetic", "test", session.Through); err != nil {
		t.Fatal(err)
	}
	alerts, err = e.Alerts(ctx, "sepolia", "synthetic", "test", 20)
	if err != nil || len(alerts) != 1 || !alerts[0].Active {
		t.Fatalf("missing alert not raised %+v %v", alerts, err)
	}
	// Later polled retrieval resolves missing presence, without inventing timing.
	event := selected(1, true)
	event.ObservedAt = testAt.Add(11 * time.Second)
	if _, _, err = e.Apply(ctx, event); err != nil {
		t.Fatal(err)
	}
	alerts, err = e.Alerts(ctx, "sepolia", "synthetic", "test", 20)
	if err != nil || len(alerts) != 1 || alerts[0].Active || alerts[0].ResolvedAt == nil {
		t.Fatalf("alert not resolved %+v %v", alerts, err)
	}
	session.Closed = true
	if err = e.Session(ctx, "sepolia", "synthetic", "test", session); err != nil {
		t.Fatal(err)
	}
	session.Through = testAt.Add(time.Hour)
	if err = e.Session(ctx, "sepolia", "synthetic", "test", session); err != nil {
		t.Fatal(err)
	}
	var through time.Time
	if err = e.Pool.QueryRow(ctx, "SELECT last_activity FROM pw_sessions").Scan(&through); err != nil || !through.Equal(testAt.Add(10*time.Second)) {
		t.Fatal("closed coverage advanced")
	}
}
func TestReplayIsolation(t *testing.T) {
	e := testEngine(t)
	d := Dataset{Network: "sepolia", Mode: "synthetic", SourceID: "test", Sessions: []Session{{ID: "s", Start: testAt, Through: testAt.Add(10 * time.Second)}}, Events: healthyEvidence()}
	raw, _ := json.Marshal(d)
	result, err := Replay(context.Background(), e, bytes.NewReader(raw), "sepolia")
	if err != nil || result.Inserted != 5 || result.States[0].Status != "healthy" {
		t.Fatalf("%+v %v", result, err)
	}
	result, err = Replay(context.Background(), e, bytes.NewReader(raw), "sepolia")
	if err != nil || result.Inserted != 0 || result.Duplicates != 5 {
		t.Fatalf("%+v %v", result, err)
	}
	d.Mode = "live"
	raw, _ = json.Marshal(d)
	if _, err = Replay(context.Background(), e, bytes.NewReader(raw), "sepolia"); err == nil {
		t.Fatal("replay accepted live mode")
	}
}
func TestStreamDisconnectAndUnavailable(t *testing.T) {
	e := testEngine(t)
	ctx := context.Background()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(501)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "event: block\ndata: {\"slot\":\"1\",\"block\":\"0x%s\"}\n\n", strings.Repeat("a", 64))
	}))
	defer server.Close()
	s := Stream{Engine: e, URL: server.URL, Network: "sepolia", SourceID: "test", IdleTimeout: time.Second}
	if err := s.once(ctx); err == nil || !strings.Contains(err.Error(), "501") {
		t.Fatalf("expected 501: %v", err)
	}
	for i := 0; i < 2; i++ {
		if err := s.once(ctx); err != io.EOF {
			t.Fatal(err)
		}
	}
	var sessions, closed int
	if err := e.Pool.QueryRow(ctx, "SELECT count(*),count(*) FILTER (WHERE closed) FROM pw_sessions").Scan(&sessions, &closed); err != nil || sessions != 2 || closed != 2 {
		t.Fatalf("restart sessions %+v %+v %v", sessions, closed, err)
	}
	states, err := e.States(ctx, "sepolia", "live", "test", nil, "", 20)
	if err != nil || len(states) != 1 || states[0].RevealLatencyMS != nil {
		t.Fatalf("stream gap created timing %+v %v", states, err)
	}
}

func TestSyntheticFixture(t *testing.T) {
	e := testEngine(t)
	file, err := os.Open("testdata/synthetic.json")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	result, err := Replay(context.Background(), e, file, "sepolia")
	if err != nil {
		t.Fatal(err)
	}
	expected := map[uint64]string{101: "healthy", 102: "warning", 103: "warning", 104: "failed", 105: "failed", 106: "pending", 107: "warning"}
	if result.Inserted != 23 || result.Duplicates != 1 || len(result.States) != 7 {
		t.Fatalf("unexpected fixture counts %+v", result)
	}
	for _, s := range result.States {
		if s.Status != expected[s.Slot] {
			t.Fatalf("wrong fixture state %+v", s)
		}
	}
}
