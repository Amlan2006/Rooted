package main

import "testing"

// Per-tx EIP-8037 dimensions must rebuild the header's gasUsed, and per-tx control timings must sum to each control total.
func TestGasDimensionsAndControlTimingsReconcile(t *testing.T) {
	r, err := run(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	var exec, state uint64
	for _, tx := range r.Samples[0].Transactions {
		exec += tx.ExecGas
		state += tx.StateGas
	}
	if max(exec, state) != r.Gas || exec == 0 {
		t.Fatalf("max(Σexecution %d, Σstate %d) != header gasUsed %d", exec, state, r.Gas)
	}
	if len(r.ControlTxNS) != len(r.ControlNS) {
		t.Fatal("missing per-tx control samples")
	}
	for i, perTx := range r.ControlTxNS {
		var sum int64
		for _, ns := range perTx {
			if ns <= 0 {
				t.Fatal("non-positive control timer")
			}
			sum += ns
		}
		if len(perTx) != r.Transactions || sum != r.ControlNS[i] {
			t.Fatalf("control sample %d: %d txs, Σ %d != %d", i, len(perTx), sum, r.ControlNS[i])
		}
	}
}
