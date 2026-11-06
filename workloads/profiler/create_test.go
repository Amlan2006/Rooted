package main

import (
	"compress/gzip"
	"os"
	"strings"
	"testing"
)

// Sepolia 12,076,302: tx 49 creates 0xd16ab44c…6f4e and tx 54 calls it. Traces use prestateTracer includeEmpty.
func TestAccountCreatedInBlockReplaysAsAbsent(t *testing.T) {
	file, err := os.Open("testdata/create-then-call-12076302.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	in, err := decodeInput(gz)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := run(in); err != nil {
		t.Fatal(err)
	}
	// Default prestateTracer output drops the empty first appearance, so the created account is seeded
	// with its post-creation code and the CREATE collides.
	for _, trace := range in.Traces {
		for addr, a := range trace.Result {
			if (a.Balance == nil || a.Balance.ToInt().Sign() == 0) && a.Nonce == 0 && len(a.Code) == 0 {
				delete(trace.Result, addr)
			}
		}
	}
	if _, err := run(in); err == nil || !strings.Contains(err.Error(), "replay tx 49 gas/status differ") {
		t.Fatalf("stripped capture: %v", err)
	}
}
