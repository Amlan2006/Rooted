package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"rooted/internal/payloadwatch"
	"rooted/internal/storage"
)

type cancelOnFlush struct {
	*httptest.ResponseRecorder
	cancel context.CancelFunc
}

func (w cancelOnFlush) Flush() { w.ResponseRecorder.Flush(); w.cancel() }

func TestPayloadWatchRoutesAndSSE(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to verify PayloadWatch APIs, metrics and resumable SSE")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("rooted_phase3_api_%d", time.Now().UnixNano())
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
	repo := &storage.Postgres{Pool: pool}
	if err = repo.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	engine := &payloadwatch.Engine{Pool: pool, Policy: payloadwatch.Policy{LateAfter: 2 * time.Second, MissingAfter: 8 * time.Second, PTCSize: 512}}
	raw, err := os.ReadFile(filepath.Join("..", "payloadwatch", "testdata", "synthetic.json"))
	if err != nil {
		t.Fatal(err)
	}
	dataset, err := payloadwatch.DecodeDataset(bytes.NewReader(raw), "sepolia")
	if err != nil {
		t.Fatal(err)
	}
	shift := time.Now().UTC().Add(-time.Minute).Sub(dataset.Sessions[0].Start)
	for i := range dataset.Events {
		dataset.Events[i].ObservedAt = dataset.Events[i].ObservedAt.Add(shift)
		if dataset.Events[i].Snapshot != nil {
			dataset.Events[i].Snapshot.FetchedAt = dataset.Events[i].Snapshot.FetchedAt.Add(shift)
		}
	}
	for i := range dataset.Sessions {
		dataset.Sessions[i].Start = dataset.Sessions[i].Start.Add(shift)
		dataset.Sessions[i].Through = dataset.Sessions[i].Through.Add(shift)
	}
	raw, err = json.Marshal(dataset)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = payloadwatch.Replay(ctx, engine, bytes.NewReader(raw), "sepolia"); err != nil {
		t.Fatal(err)
	}
	server := &Server{Watch: engine, Network: "sepolia", SourceID: "node-alpha"}
	handler := server.Handler()
	read := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil).WithContext(ctx))
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
		return w
	}
	scope := "network=sepolia&mode=synthetic&source=" + dataset.SourceID
	var states struct {
		Data []payloadwatch.State `json:"data"`
	}
	if err = json.Unmarshal(read("/api/v1/slots?"+scope).Body.Bytes(), &states); err != nil {
		t.Fatal(err)
	}
	if len(states.Data) != 7 {
		t.Fatalf("lost replay states: %d", len(states.Data))
	}
	var builders struct {
		Data []payloadwatch.BuilderStats `json:"data"`
	}
	if err = json.Unmarshal(read("/api/v1/builders?"+scope+"&window=1h").Body.Bytes(), &builders); err != nil {
		t.Fatal(err)
	}
	if len(builders.Data) != 1 || builders.Data[0].Observations != 7 || builders.Data[0].Healthy != 1 || builders.Data[0].Failed != 2 || builders.Data[0].Timed != 4 {
		t.Fatalf("wrong builder denominator: %+v", builders.Data)
	}
	read("/api/v1/builders/42?" + scope)
	read("/api/v1/alerts?" + scope)
	read("/api/v1/payloadwatch/slots/101?" + scope)
	var timeline struct {
		Data []payloadwatch.JournalEntry `json:"data"`
	}
	if err = json.Unmarshal(read("/api/v1/payloadwatch/slots/101/timeline?"+scope).Body.Bytes(), &timeline); err != nil {
		t.Fatal(err)
	}
	if len(timeline.Data) != 5 {
		t.Fatalf("duplicate or missing timeline entries: %d", len(timeline.Data))
	}
	cursor := timeline.Data[len(timeline.Data)-1].Sequence
	var tail struct {
		Data []payloadwatch.JournalEntry `json:"data"`
	}
	if err = json.Unmarshal(read(fmt.Sprintf("/api/v1/payloadwatch/slots/101/timeline?%s&after=%d", scope, cursor)).Body.Bytes(), &tail); err != nil || len(tail.Data) != 0 {
		t.Fatalf("cursor repeated timeline: %+v %v", tail, err)
	}
	var live struct {
		Data []payloadwatch.State `json:"data"`
	}
	if err = json.Unmarshal(read("/api/v1/slots?network=sepolia").Body.Bytes(), &live); err != nil || len(live.Data) != 0 {
		t.Fatal("synthetic data leaked into configured live source")
	}
	var collector struct {
		Source string `json:"source"`
	}
	if err = json.Unmarshal(read("/api/v1/collector?network=sepolia").Body.Bytes(), &collector); err != nil || collector.Source != "node-alpha" {
		t.Fatal("collector did not retain configured source")
	}
	metrics := read("/metrics")
	if !strings.Contains(metrics.Body.String(), "rooted_payload_observed_total") || strings.Contains(metrics.Body.String(), `mode="synthetic"`) || !strings.Contains(metrics.Header().Get("Content-Type"), "text/plain") {
		t.Fatal("metrics scope or format changed")
	}
	streamCtx, stop := context.WithCancel(ctx)
	defer stop()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/live?"+scope, nil).WithContext(streamCtx)
	request.Header.Set("Last-Event-ID", strconv.FormatInt(cursor, 10))
	writer := cancelOnFlush{httptest.NewRecorder(), stop}
	handler.ServeHTTP(writer, request)
	if writer.Header().Get("Content-Type") != "text/event-stream" || !strings.Contains(writer.Body.String(), "event: snapshot") {
		t.Fatalf("missing SSE snapshot: %s", writer.Body)
	}
	scanner := bufio.NewScanner(strings.NewReader(writer.Body.String()))
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "id: ") {
			sequence, err := strconv.ParseInt(strings.TrimPrefix(scanner.Text(), "id: "), 10, 64)
			if err != nil || sequence <= cursor {
				t.Fatalf("resume repeated an event: %q", scanner.Text())
			}
		}
	}
	if err = scanner.Err(); err != nil {
		t.Fatal(err)
	}
}
