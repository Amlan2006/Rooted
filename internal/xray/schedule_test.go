package xray

import (
	"math"
	"reflect"
	"testing"
)

func TestCeilingsAndSpeedups(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		t                    []int64
		preds                [][]int
		validator, builder   float64
		path                 []int
		k2v, k2b             float64
		builderCap, validCap int
	}{
		{"chain", []int64{1, 2, 3}, [][]int{nil, {0}, {1}}, 2, 1, []int{0, 1, 2}, 2, 1, 2, 2},
		{"fan-out", []int64{1, 1, 1, 1}, [][]int{nil, {0}, {0}, {0}}, 4, 2, []int{0, 1}, 2, 4.0 / 3, 0, 0},
		{"single fat tx", []int64{10, 1, 1, 1}, [][]int{nil, nil, nil, nil}, 1.3, 1.3, []int{0}, 1.3, 1.3, 0, 0},
		{"ties pick smallest index", []int64{5, 5, 5}, [][]int{nil, nil, nil}, 3, 3, []int{0}, 1.5, 1.5, 0, 0},
	} {
		g := make([]uint64, len(tc.t))
		for i, v := range tc.t {
			g[i] = uint64(v) * 1000
		}
		gas, v, b := Ceilings(tc.t, g, tc.preds)
		if !near(*v.Value, tc.validator) || !near(*b.Value, tc.builder) || !near(*gas.Value, tc.validator) {
			t.Fatalf("%s: ceilings gas %v validator %v builder %v", tc.name, *gas.Value, *v.Value, *b.Value)
		}
		if !reflect.DeepEqual(b.CriticalPath, tc.path) || *b.CappingTx != tc.builderCap || *v.CappingTx != tc.validCap || *gas.CappingTx != tc.validCap {
			t.Fatalf("%s: path %v builder cap %d validator cap %d", tc.name, b.CriticalPath, *b.CappingTx, *v.CappingTx)
		}
		vs, bs := Speedups(tc.t, tc.preds, Cores)
		if len(vs) != 5 || len(bs) != 5 || vs[0] != 1 || bs[0] != 1 || !near(vs[1], tc.k2v) || !near(bs[1], tc.k2b) {
			t.Fatalf("%s: speedups %v %v", tc.name, vs, bs)
		}
		for i := range vs {
			if vs[i] > tc.validator+1e-9 || bs[i] > tc.builder+1e-9 || bs[i] > vs[i]+1e-9 {
				t.Fatalf("%s: schedule beats its ceiling %v %v", tc.name, vs, bs)
			}
		}
	}
	gas, v, b := Ceilings(nil, []uint64{21000, 42000}, [][]int{nil, nil})
	vs, bs := Speedups(nil, nil, Cores)
	if *gas.Value != 1.5 || v.Value != nil || b.Value != nil || b.CriticalPath != nil || vs != nil || bs != nil {
		t.Fatal("missing metrics must leave time views null")
	}
}

func TestSummaryNearestRank(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	i := func(v int) *int { return &v }
	briefs := []Brief{
		{BlockNumber: 3, CommitmentVerified: true, GasWeighted: f(2), ValidatorBALTime: f(3), BuilderDAGTime: f(1), GasCappingTx: i(1), ValidatorCappingTx: i(1), BuilderCriticalPathLength: i(1), Speedup8Validator: f(3), Speedup8Builder: f(1)},
		{BlockNumber: 1, CommitmentVerified: true, GasWeighted: f(4), ValidatorBALTime: f(5), BuilderDAGTime: f(2), GasCappingTx: i(0), ValidatorCappingTx: i(2), BuilderCriticalPathLength: i(4), Speedup8Validator: f(5), Speedup8Builder: f(2)},
		{BlockNumber: 2, GasWeighted: f(6), GasCappingTx: i(0)},
	}
	s := Summarize(briefs)
	if s.Blocks != 3 || *s.FromBlock != 1 || *s.ToBlock != 3 || s.Ceilings.Gas.Median != 4 || s.Ceilings.Gas.P10 != 2 || s.Ceilings.Gas.P90 != 6 || s.Ceilings.Validator.Median != 3 {
		t.Fatalf("%+v", s)
	}
	if *s.SingleTxBound != 0.5 || *s.GasMisidentifies != 0.5 || !near(*s.CommitmentVerified, 2.0/3) || *s.Speedup8.Validator != 3 || *s.Speedup8.Builder != 1 {
		t.Fatalf("shares %+v", s)
	}
	if e := Summarize(nil); e.Blocks != 0 || e.Ceilings.Gas != nil || e.SingleTxBound != nil || e.FromBlock != nil {
		t.Fatal("empty summary must be null, not zero")
	}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }
