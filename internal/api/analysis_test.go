package api

import (
	"net/http/httptest"
	"rooted/internal/analysis"
	"strings"
	"testing"
)

func TestAnalysisScopeAndInputErrors(t *testing.T) {
	s := &Server{Network: "sepolia", Analysis: &analysis.Store{}, Analyzer: &analysis.Collector{}}
	hash := "0x" + strings.Repeat("1", 64)
	cases := []struct {
		method, path, body string
		status             int
	}{
		{"POST", "/api/v1/analysis/transactions/bad/ingest?network=sepolia", `{}`, 400},
		{"POST", "/api/v1/analysis/transactions/" + hash + "/ingest?network=sepolia", `{"transactions":["` + hash + `"]}`, 400},
		{"POST", "/api/v1/analysis/transactions/" + hash + "/ingest?network=sepolia-fork&mode=fork", `{}`, 400},
		{"GET", "/api/v1/analysis/runs", "", 400},
		{"GET", "/api/v1/analysis/runs?network=mainnet", "", 400},
		{"GET", "/api/v1/analysis/runs?network=sepolia-fork", "", 400},
		{"GET", "/api/v1/analysis/runs?network=sepolia&mode=fork", "", 400},
		{"GET", "/api/v1/analysis/runs?network=sepolia&limit=100", "", 400},
		{"GET", "/api/v1/analysis/runs/no?network=sepolia", "", 400},
		{"POST", "/api/v1/analysis/blocks/" + hash + "/ingest?network=sepolia", `{"transactions":[]} {}`, 400},
		{"POST", "/api/v1/analysis/blocks/" + hash + "/ingest?network=sepolia", `{"transactions":["bad"]}`, 400},
		{"POST", "/api/v1/analysis/blocks/" + hash + "/ingest?network=sepolia", `{"unknown":true}`, 400},
		{"POST", "/api/v1/analysis/blocks/no/ingest?network=sepolia", `{"transactions":[]}`, 400},
		{"POST", "/api/v1/analysis/blocks/" + hash + "/ingest?network=sepolia-fork&mode=fork", `{"transactions":[]}`, 400},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, w.Code, w.Body)
		}
	}
}
