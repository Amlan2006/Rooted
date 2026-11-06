package api

import (
	"net/http/httptest"
	"rooted/internal/profiler"
	"strings"
	"testing"
)

func TestProfilerScopeAndInputBoundaries(t *testing.T) {
	s := &Server{Network: "sepolia", Profiles: &profiler.Store{}, Profiler: &profiler.Collector{}, ProfileGate: make(chan struct{}, 1)}
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/v1/profiles", "", 400},
		{"GET", "/api/v1/profiles?network=sepolia&mode=live", "", 400},
		{"GET", "/api/v1/profiles/no?network=sepolia&mode=replay", "", 400},
		{"POST", "/api/v1/profiles?network=sepolia&mode=replay", `{"block_hash":"latest"}`, 400},
		{"POST", "/api/v1/profiles?network=sepolia&mode=replay", `{"url":"http://private.invalid"}`, 400},
		{"POST", "/api/v1/profiles?network=sepolia&mode=replay", `null`, 400},
		{"POST", "/api/v1/profiles/no/replay?network=sepolia&mode=replay", `{}`, 400},
		{"POST", "/api/v1/profiles?network=sepolia&mode=replay", `{} {}`, 400},
	} {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body)
		}
	}
	s.ProfileGate <- struct{}{}
	r := httptest.NewRequest("POST", "/api/v1/profiles?network=sepolia&mode=replay", strings.NewReader(`{"block_hash":"0x`+strings.Repeat("a", 64)+`"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 429 {
		t.Fatal("concurrent profiling was not bounded", w.Code)
	}
}
