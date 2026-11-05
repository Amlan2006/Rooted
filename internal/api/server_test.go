package api

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"rooted/internal/domain"
	"rooted/internal/ingest"
)

type fakeRepo struct {
	items []domain.Observation
	err   error
	saved int
}

func (f *fakeRepo) Save(context.Context, domain.Snapshot) error { f.saved++; return f.err }
func (f *fakeRepo) List(context.Context, string, uint64, string) ([]domain.Observation, error) {
	return f.items, f.err
}
func (f *fakeRepo) Ping(context.Context) error { return f.err }

type fakeFetch struct{ err error }

func (f fakeFetch) Fetch(context.Context, uint64) (domain.Snapshot, error) {
	return domain.Snapshot{}, f.err
}

func TestAPIOutcomes(t *testing.T) {
	cases := []struct {
		name, method, path string
		items              []domain.Observation
		fetchErr, errorDB  error
		want               int
	}{
		{name: "health", method: "GET", path: "/health", want: 200},
		{name: "database health failure", method: "GET", path: "/health", errorDB: errors.New("down"), want: 503},
		{name: "network required", method: "GET", path: "/api/v1/slots/42", want: 400},
		{name: "wrong network", method: "GET", path: "/api/v1/slots/42?network=mainnet", want: 400},
		{name: "invalid slot", method: "GET", path: "/api/v1/slots/-1?network=sepolia", want: 400},
		{name: "invalid root", method: "GET", path: "/api/v1/slots/42?network=sepolia&block_root=no", want: 400},
		{name: "not ingested", method: "GET", path: "/api/v1/slots/42?network=sepolia", want: 404},
		{name: "fork ambiguity", method: "GET", path: "/api/v1/slots/42?network=sepolia", items: []domain.Observation{{BlockRoot: "a"}, {BlockRoot: "b"}}, want: 409},
		{name: "stored record", method: "GET", path: "/api/v1/slots/42?network=sepolia", items: []domain.Observation{{Slot: 42}}, want: 200},
		{name: "upstream failure", method: "POST", path: "/api/v1/slots/42/ingest?network=sepolia", fetchErr: errors.New("RPC down"), want: 502},
		{name: "unavailable", method: "POST", path: "/api/v1/slots/42/ingest?network=sepolia", fetchErr: ingest.ErrUnavailable, want: 404},
		{name: "mismatch", method: "POST", path: "/api/v1/slots/42/ingest?network=sepolia", fetchErr: ingest.ErrMismatch, want: 422},
		{name: "unsupported block", method: "POST", path: "/api/v1/slots/42/ingest?network=sepolia", fetchErr: ingest.ErrUnsupported, want: 422},
		{name: "timeout", method: "POST", path: "/api/v1/slots/42/ingest?network=sepolia", fetchErr: context.DeadlineExceeded, want: 504},
		{name: "storage failure", method: "POST", path: "/api/v1/slots/42/ingest?network=sepolia", errorDB: errors.New("down"), want: 500},
		{name: "success", method: "POST", path: "/api/v1/slots/42/ingest?network=sepolia", want: 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeRepo{items: tc.items, err: tc.errorDB}
			s := &Server{Repository: repo, Collector: fakeFetch{tc.fetchErr}, Network: "sepolia"}
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
			if w.Code != tc.want {
				t.Fatalf("got %d want %d: %s", w.Code, tc.want, w.Body)
			}
			if tc.fetchErr != nil && repo.saved != 0 {
				t.Fatal("persisted invalid upstream snapshot")
			}
			if w.Header().Get("Content-Type") != "application/json" {
				t.Fatal("response is not JSON")
			}
		})
	}
}

type scopeRepo struct {
	fakeRepo
	network, root string
	slot          uint64
}

func (f *scopeRepo) List(_ context.Context, network string, slot uint64, root string) ([]domain.Observation, error) {
	f.network, f.slot, f.root = network, slot, root
	return f.items, nil
}

func TestExplicitRootAndNetworkArePreserved(t *testing.T) {
	root := "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	repo := &scopeRepo{fakeRepo: fakeRepo{items: []domain.Observation{{Slot: 42}}}}
	s := &Server{Repository: repo, Network: "sepolia"}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/slots/42?network=sepolia&block_root="+root, nil))
	if w.Code != 200 || repo.network != "sepolia" || repo.slot != 42 || repo.root != "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("scoped read changed identities: %d %+v", w.Code, repo)
	}
}
