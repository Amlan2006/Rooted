package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"rooted/internal/payloadwatch"
)

func TestPayloadWatchRequestValidation(t *testing.T) {
	server := &Server{Watch: &payloadwatch.Engine{}, Network: "sepolia", SourceID: "configured-source"}
	for _, tc := range []struct{ path, header, code string }{
		{"/api/v1/slots", "", "invalid_network"},
		{"/api/v1/slots?network=other", "", "invalid_network"},
		{"/api/v1/slots?network=sepolia&mode=fork", "", "invalid_mode"},
		{"/api/v1/slots?network=sepolia&source=" + strings.Repeat("x", 101), "", "invalid_source"},
		{"/api/v1/slots?network=sepolia&limit=0", "", "invalid_limit"},
		{"/api/v1/slots?network=sepolia&limit=201", "", "invalid_limit"},
		{"/api/v1/payloadwatch/slots/nope?network=sepolia", "", "invalid_slot"},
		{"/api/v1/payloadwatch/slots/1/timeline?network=sepolia&after=-1", "", "invalid_cursor"},
		{"/api/v1/builders?network=sepolia&window=1s", "", "invalid_window"},
		{"/api/v1/builders?network=sepolia&window=169h", "", "invalid_window"},
		{"/api/v1/builders/not-an-index?network=sepolia", "", "invalid_builder"},
		{"/api/v1/live?network=sepolia&after=-1", "", "invalid_cursor"},
		{"/api/v1/live?network=sepolia&after=0", "invalid", "invalid_cursor"},
	} {
		t.Run(tc.path+tc.header, func(t *testing.T) {
			r := httptest.NewRequest("GET", tc.path, nil)
			if tc.header != "" {
				r.Header.Set("Last-Event-ID", tc.header)
			}
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, r)
			var response ErrorResponse
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if w.Code != 400 || response.Error.Code != tc.code {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}

func TestPayloadWatchMissingConfiguration(t *testing.T) {
	server := &Server{Network: "sepolia"}
	for _, path := range []string{"/api/v1/slots?network=sepolia", "/api/v1/collector?network=sepolia", "/api/v1/live?network=sepolia", "/metrics"} {
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 503 {
			t.Fatalf("unconfigured watch route %s returned %d", path, w.Code)
		}
	}
}

func TestWatchScopeUsesConfiguredSource(t *testing.T) {
	server := &Server{Watch: &payloadwatch.Engine{}, Network: "sepolia", SourceID: "node-one"}
	request := httptest.NewRequest("GET", "/api/v1/slots?network=sepolia", nil)
	mode, source, limit, ok := server.watchScope(httptest.NewRecorder(), request)
	if !ok || mode != "live" || source != "node-one" || limit != 50 {
		t.Fatalf("scope changed: %s %s %d %v", mode, source, limit, ok)
	}
}
