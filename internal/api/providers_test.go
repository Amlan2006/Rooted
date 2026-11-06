package api

import (
	"net/http/httptest"
	"rooted/internal/providers"
	"strings"
	"testing"
)

func TestProviderRequestBoundary(t *testing.T) {
	s := &Server{Network: "sepolia", Providers: &providers.Store{}, ProviderChecks: &providers.Collector{}, ProviderGate: make(chan struct{}, 1)}
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/v1/providers/comparisons", "", 400},
		{"GET", "/api/v1/providers/comparisons?network=mainnet", "", 400},
		{"GET", "/api/v1/providers/comparisons/no?network=sepolia", "", 400},
		{"POST", "/api/v1/providers/compare?network=sepolia", `{"url":"http://private.invalid"}`, 400},
		{"POST", "/api/v1/providers/compare?network=sepolia", `{"block_hash":"latest"}`, 400},
		{"POST", "/api/v1/providers/compare?network=sepolia", `{} {}`, 400},
		{"POST", "/api/v1/providers/compare?network=sepolia", `null`, 400},
		{"POST", "/api/v1/providers/compare?network=sepolia", strings.Repeat(" ", 1025) + "{}", 400},
	} {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body)
		}
	}
	s.ProviderGate <- struct{}{}
	r := httptest.NewRequest("POST", "/api/v1/providers/compare?network=sepolia", strings.NewReader("{}"))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 429 {
		t.Fatal(w.Code, w.Body)
	}
}
