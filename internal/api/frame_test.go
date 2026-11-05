package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"rooted/internal/framemempool"
)

func TestFrameScopeAndInputValidation(t *testing.T) {
	server := &Server{Frames: &framemempool.Store{}, FrameNetwork: "frame-devnet"}
	for _, tc := range []struct{ path, code string }{
		{"/api/v1/frames/node", "invalid_network"},
		{"/api/v1/frames/transactions?network=sepolia", "invalid_network"},
		{"/api/v1/frames/transactions?network=frame-devnet&mode=replay", "invalid_mode"},
		{"/api/v1/frames/transactions?network=frame-devnet&node=unknown", "invalid_node"},
		{"/api/v1/frames/transactions?network=frame-devnet&limit=0", "invalid_limit"},
		{"/api/v1/frames/transactions?network=frame-devnet&limit=201", "invalid_limit"},
		{"/api/v1/frames/transactions/invalid?network=frame-devnet", "invalid_hash"},
		{"/api/v1/frames/transactions/invalid/evidence?network=frame-devnet", "invalid_hash"},
		{"/api/v1/frames/transactions/0x" + strings.Repeat("a", 64) + "/evidence?network=frame-devnet&after=-1", "invalid_cursor"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
			var body ErrorResponse
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 400 || body.Error.Code != tc.code {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
	request := httptest.NewRequest("GET", "/api/v1/frames/node?network=frame-devnet", nil)
	scope, limit, ok := server.frameScope(httptest.NewRecorder(), request)
	if !ok || scope.Mode != "live" || scope.Node != "gateway" || limit != 50 {
		t.Fatalf("unexpected defaults: %+v %d", scope, limit)
	}
}

func TestFrameRoutesRequireStoreAndExposeNoMutations(t *testing.T) {
	server := &Server{FrameNetwork: "frame-devnet"}
	for _, path := range []string{"node", "transactions", "incidents", "submissions"} {
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/frames/"+path+"?network=frame-devnet", nil))
		if w.Code != 503 {
			t.Fatalf("missing store returned %d", w.Code)
		}
	}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/frames/submissions?network=frame-devnet", nil))
	if w.Code == 200 || w.Code == 201 {
		t.Fatal("HTTP unexpectedly exposed transaction submission")
	}
}
