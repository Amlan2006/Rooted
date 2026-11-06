package xray

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"rooted/internal/bal"
	"rooted/internal/profiler"
)

// fixtureInputs loads block 12075748 with its metrics passed through edit (nil edit keeps them as stored).
func fixtureInputs(t *testing.T, edit func(m map[string]any)) Inputs {
	t.Helper()
	var capture profiler.Capture
	if err := json.Unmarshal(gunzip(t, "fixtures/capture-12075748.json.gz"), &capture); err != nil {
		t.Fatal(err)
	}
	var b rawBlock
	_ = json.Unmarshal(capture.Block, &b)
	envelope, err := os.ReadFile("fixtures/envelope-12075748.json")
	if err != nil {
		t.Fatal(err)
	}
	slot, _ := bal.Number(*b.Slot)
	native, env, err := parseEnvelope(envelope, slot, b.Hash, 12075748, len(b.Transactions), b.BALHash)
	if err != nil {
		t.Fatal(err)
	}
	raw := gunzip(t, "fixtures/metrics-12075748.json.gz")
	if edit != nil {
		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		edit(m)
		raw, _ = json.Marshal(m)
	}
	return Inputs{Capture: capture, Native: native, Metrics: raw, Envelope: &env, Source: "capture"}
}

// withControl gives every control sample per-tx timings (1 µs each, the rest on tx 5) and per-tx EIP-8037 dimensions.
func withControl(execution func(i int) float64) func(m map[string]any) {
	return func(m map[string]any) {
		control := [][]float64{}
		for _, total := range m["control_apply_ns"].([]any) {
			row := make([]float64, 101)
			for i := range row {
				row[i] = 1000
			}
			row[5] = total.(float64) - 100*1000
			control = append(control, row)
		}
		m["control_transaction_apply_ns"] = control
		for _, s := range m["samples"].([]any) {
			for i, tx := range s.(map[string]any)["transactions"].([]any) {
				tx.(map[string]any)["execution_gas"], tx.(map[string]any)["state_gas"] = execution(i), 0
			}
		}
	}
}

func TestTimesComeFromUninstrumentedControlSamples(t *testing.T) {
	legacy, err := Compute(fixtureInputs(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Replay.Timing != TimingInstrumented || !slices.Contains(legacy.Coverage, "apply_ns_from_instrumented_replay") || !slices.Contains(legacy.Coverage, "execution_gas_unavailable") || legacy.Ceilings.Execution.Value != nil {
		t.Fatalf("legacy profile must be flagged: %+v %v", legacy.Replay, legacy.Coverage)
	}
	// Header gasUsed 62,098,256 = tx 0's 61,998,256 execution gas + 100 × 1,000.
	exec := func(i int) float64 {
		if i == 0 {
			return 62098256 - 100*1000
		}
		return 1000
	}
	r, err := Compute(fixtureInputs(t, withControl(exec)))
	if err != nil {
		t.Fatal(err)
	}
	if r.Replay.Timing != TimingControl || r.Replay.MedianNS != 230363337 || r.Replay.Samples != 7 || slices.Contains(r.Coverage, "apply_ns_from_instrumented_replay") {
		t.Fatalf("replay %+v coverage %v", r.Replay, r.Coverage)
	}
	if *r.Transactions[0].ApplyNS != 1000 || *r.Transactions[5].ApplyNS != 230363337-100*1000 || *r.Ceilings.Validator.CappingTx != 5 || !near(*r.Ceilings.Validator.Value, 230363337.0/(230363337-100*1000)) {
		t.Fatalf("control medians %d %d %+v", *r.Transactions[0].ApplyNS, *r.Transactions[5].ApplyNS, r.Ceilings.Validator)
	}
	if *r.Transactions[0].ExecutionGas != 61998256 || *r.Ceilings.Execution.CappingTx != 0 || !near(*r.Ceilings.Execution.Value, 62098256.0/61998256) || r.Ceilings.Execution.Weight != "execution_gas" {
		t.Fatalf("execution ceiling %+v", r.Ceilings.Execution)
	}
	if _, err := Compute(fixtureInputs(t, withControl(func(int) float64 { return 1000 }))); err == nil {
		t.Fatal("execution gas that does not rebuild header gasUsed must be rejected")
	}
	if _, err := Compute(fixtureInputs(t, func(m map[string]any) { withControl(exec)(m); m["control_transaction_apply_ns"].([][]float64)[0][1]++ })); err == nil {
		t.Fatal("per-tx control timings that do not sum to the control total must be rejected")
	}
}

func TestBriefCountsOnlyStrictGasMisidentification(t *testing.T) {
	r, err := Compute(fixtureInputs(t, withControl(func(i int) float64 {
		if i == 0 {
			return 62098256 - 100*1000
		}
		return 1000
	})))
	if err != nil {
		t.Fatal(err)
	}
	b := BriefOf(r) // time caps on tx 5 (1,000 execution gas) while gas caps on tx 0
	if b.GasMisidentifies == nil || !*b.GasMisidentifies || b.ExecutionGasMisidentifies == nil || !*b.ExecutionGasMisidentifies || b.ExecutionGasWeighted == nil {
		t.Fatalf("brief %+v", b)
	}
	f, i := func(v bool) *bool { return &v }, func(v int) *int { return &v }
	// Different capping indices with equal gas (a tie) are not a misidentification once the strict flag exists.
	tie := Brief{GasCappingTx: i(1), ValidatorCappingTx: i(2), BuilderCriticalPathLength: i(1), GasMisidentifies: f(false), ExecutionGasMisidentifies: f(false)}
	s := Summarize([]Brief{b, tie, tie, tie})
	if *s.GasMisidentifies != 0.25 || *s.ExecMisidentifies != 0.25 || s.Ceilings.Execution == nil {
		t.Fatalf("summary %+v", s)
	}
	if legacy := Summarize([]Brief{{GasCappingTx: i(1), ValidatorCappingTx: i(2), BuilderCriticalPathLength: i(1)}}); *legacy.GasMisidentifies != 1 || legacy.ExecMisidentifies != nil {
		t.Fatalf("legacy summary %+v", legacy)
	}
}
