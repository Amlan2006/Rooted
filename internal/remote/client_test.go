package remote

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fixtureTransport func(*http.Request) (*http.Response, error)

func (f fixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func fixtureClient(handler http.Handler) *Client {
	return NewWithHTTPClient("http://recorded.invalid/private-api-key?secret=hidden", &http.Client{
		Timeout: time.Second,
		Transport: fixtureTransport(func(r *http.Request) (*http.Response, error) {
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			return w.Result(), nil
		}),
	})
}

func TestRPCErrorAndCredentialRedaction(t *testing.T) {
	c := fixtureClient(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","error":{"code":-32601,"message":"secret-provider-details"},"id":1}`))
	}))
	_, err := c.RPC(context.Background(), "eth_chainId", []any{})
	if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "private-api-key") {
		t.Fatalf("error missing or leaked provider details: %v", err)
	}
}
func TestEvidenceOriginOmitsCredentials(t *testing.T) {
	c := fixtureClient(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"data":{}}`)) }))
	r, err := c.Get(context.Background(), "/path", "example")
	if err != nil {
		t.Fatal(err)
	}
	if r.Origin != "http://recorded.invalid" {
		t.Fatalf("origin leaked URL detail: %s", r.Origin)
	}
}

func TestHTTPAndRPCFailures(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"not found", `{}`, 404},
		{"upstream failure", `{}`, 503},
		{"invalid JSON", `not json`, 200},
		{"missing RPC result", `{"jsonrpc":"2.0","id":1}`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := fixtureClient(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			_, err := c.RPC(context.Background(), "eth_chainId", []any{})
			if err == nil {
				t.Fatal("expected upstream error")
			}
			if tc.status == 404 && !errors.Is(err, ErrNotFound) {
				t.Fatalf("lost unavailable status: %v", err)
			}
		})
	}
}

func TestTimeoutRetainsDeadlineClassification(t *testing.T) {
	c := NewWithHTTPClient("http://recorded.invalid", &http.Client{Timeout: 10 * time.Millisecond,
		Transport: fixtureTransport(func(r *http.Request) (*http.Response, error) {
			<-r.Context().Done()
			return nil, r.Context().Err()
		})})
	_, err := c.RPC(context.Background(), "eth_chainId", []any{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline, got %v", err)
	}
}
