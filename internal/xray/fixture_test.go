package xray

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"slices"
	"testing"

	"rooted/internal/bal"
	"rooted/internal/profiler"
)

func gunzip(t *testing.T, path string) []byte {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Live Sepolia block 12075748 (see fixtures/README.md): values pinned from the live `rooted xray` run.
func TestFixtureBlock12075748(t *testing.T) {
	var capture profiler.Capture
	if err := json.Unmarshal(gunzip(t, "fixtures/capture-12075748.json.gz"), &capture); err != nil {
		t.Fatal(err)
	}
	var b rawBlock
	if err := json.Unmarshal(capture.Block, &b); err != nil {
		t.Fatal(err)
	}
	envelope, err := os.ReadFile("fixtures/envelope-12075748.json")
	if err != nil {
		t.Fatal(err)
	}
	slot, _ := bal.Number(*b.Slot)
	native, env, err := parseEnvelope(envelope, slot, b.Hash, 12075748, len(b.Transactions), b.BALHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := parseEnvelope(envelope, slot+1, b.Hash, 12075748, len(b.Transactions), b.BALHash); err == nil {
		t.Fatal("envelope accepted for another slot")
	}
	r, err := Compute(Inputs{Capture: capture, Native: native, Metrics: gunzip(t, "fixtures/metrics-12075748.json.gz"), Envelope: &env, Source: "capture"})
	if err != nil {
		t.Fatal(err)
	}
	c := r.Ceilings
	if !r.BAL.CommitmentVerified || len(r.Transactions) != 101 || r.Block.TransactionCount != 101 || r.EPBS.BuilderIndex != "12" || *r.Block.Slot != 11518713 {
		t.Fatalf("identity %+v %+v", r.Block, r.BAL)
	}
	if !near(*c.Gas.Value, 86532542.0/21105490) || *c.Gas.CappingTx != 0 || !r.Transactions[0].IsCreate || r.Gas.HeaderGasUsed != 62098256 || r.Gas.ReceiptsGasSum != 86532542 {
		t.Fatalf("gas view %+v %+v", c.Gas, r.Gas)
	}
	if !near(*c.Validator.Value, 19.127189547208435) || *c.Validator.CappingTx != 13 || !slices.Equal(c.Builder.CriticalPath, []int{13}) || *c.Builder.Value > *c.Validator.Value {
		t.Fatalf("time views %+v %+v", c.Validator, c.Builder)
	}
	for i := range r.Schedules.Cores {
		if r.Schedules.Validator[i] < 1 || r.Schedules.Builder[i] > r.Schedules.Validator[i]+1e-9 || r.Schedules.Validator[i] > *c.Validator.Value+1e-9 {
			t.Fatalf("schedules %+v", r.Schedules)
		}
	}
	if r.Edges.Total != 260 || r.Edges.DependentPairs != 47 || r.Independent != 86 || r.Uniswap.V3Swaps != 3 || len(r.HotLocations) != 10 {
		t.Fatalf("graph %+v independent %d uniswap %+v", r.Edges, r.Independent, r.Uniswap)
	}
}
