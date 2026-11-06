package profiler

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func capturedInput(t *testing.T) []byte {
	t.Helper()
	f, err := os.Open("../../demo/profiler/replay-input.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	raw, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestSavedCaptureIdentityAndDigestFailBeforeExecution(t *testing.T) {
	input := capturedInput(t)
	for _, kind := range []string{"block", "number", "digest", "json"} {
		t.Run(kind, func(t *testing.T) {
			p := profile(t)
			body := input
			want := "stored capture identity mismatch"
			switch kind {
			case "block":
				p.BlockHash = "0x" + strings.Repeat("0", 64)
			case "number":
				p.BlockNumber = "0x1"
			case "digest":
				p.CaptureDigest = strings.Repeat("0", 64)
				want = "stored capture digest mismatch"
			case "json":
				body = []byte(`{} {}`)
			}
			// The specific guard error is required; any later failure (e.g. runner lookup) means the guard did not fire.
			if _, _, err := (&Collector{Binary: "true"}).Measure(context.Background(), p, body); err == nil || err.Error() != want {
				t.Fatalf("invalid capture reached native execution: %v", err)
			}
		})
	}
}

func TestNativeOutputCannotGrowBeyondLimit(t *testing.T) {
	b := boundedOutput{limit: 32}
	if _, err := b.Write(bytes.Repeat([]byte("a"), 32)); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Write([]byte("b")); err == nil || !b.exceeded || b.Len() != 32 {
		t.Fatal("native output limit failed")
	}
}

type batchTransport func(*http.Request) (*http.Response, error)

func (f batchTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAncestorBatchBindsOutOfOrderIDsAndRejectsAmbiguity(t *testing.T) {
	for _, kind := range []string{"valid", "duplicate", "missing", "rpc_error", "null"} {
		t.Run(kind, func(t *testing.T) {
			rows := []map[string]any{{"id": 1, "result": map[string]any{"number": "0x0"}}, {"id": 0, "result": map[string]any{"number": "0x1"}}}
			switch kind {
			case "duplicate":
				rows[0]["id"] = 0
			case "missing":
				rows = rows[:1]
			case "rpc_error":
				rows[0]["error"] = map[string]any{"code": -32000}
			case "null":
				rows[0]["result"] = nil
			}
			raw, _ := json.Marshal(rows)
			c := Collector{Endpoint: "https://fixture.invalid", Transport: batchTransport(func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: http.Header{}}, nil
			})}
			result, err := c.ancestors(context.Background(), 2)
			if kind != "valid" {
				if err == nil {
					t.Fatal("ambiguous ancestor batch accepted")
				}
				return
			}
			if err != nil || len(result) != 2 || !bytes.Contains(result[0], []byte(`"0x1"`)) {
				t.Fatalf("incorrect ordered ancestors: %s %v", result, err)
			}
		})
	}
}
