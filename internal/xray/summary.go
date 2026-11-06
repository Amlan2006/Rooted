package xray

import (
	"math"
	"sort"
)

func BriefOf(r Report) Brief {
	b := Brief{BlockHash: r.Block.Hash, BlockNumber: r.Block.Number, Slot: r.Block.Slot, ComputedAt: r.ComputedAt, Source: r.Source, TransactionCount: r.Block.TransactionCount, HeaderGasUsed: r.Gas.HeaderGasUsed, ReceiptsGasSum: r.Gas.ReceiptsGasSum, CommitmentVerified: r.BAL.CommitmentVerified,
		GasWeighted: r.Ceilings.Gas.Value, ExecutionGasWeighted: r.Ceilings.Execution.Value, ValidatorBALTime: r.Ceilings.Validator.Value, BuilderDAGTime: r.Ceilings.Builder.Value, GasCappingTx: r.Ceilings.Gas.CappingTx, ValidatorCappingTx: r.Ceilings.Validator.CappingTx}
	if r.Ceilings.Builder.Value != nil {
		n := len(r.Ceilings.Builder.CriticalPath)
		b.BuilderCriticalPathLength = &n
	}
	at8 := func(s []float64) *float64 {
		for i, k := range r.Schedules.Cores {
			if k == 8 && i < len(s) {
				return &s[i]
			}
		}
		return nil
	}
	b.Speedup8Validator, b.Speedup8Builder = at8(r.Schedules.Validator), at8(r.Schedules.Builder)
	if r.EPBS != nil {
		b.BuilderIndex = &r.EPBS.BuilderIndex
	}
	if c := r.Ceilings.Validator.CappingTx; c != nil && *c < len(r.Transactions) {
		tx := r.Transactions[*c]
		if r.Ceilings.Gas.Bottleneck != nil {
			v := int64(tx.GasUsed) < *r.Ceilings.Gas.Bottleneck
			b.GasMisidentifies = &v
		}
		if r.Ceilings.Execution.Bottleneck != nil && tx.ExecutionGas != nil {
			v := int64(*tx.ExecutionGas) < *r.Ceilings.Execution.Bottleneck
			b.ExecutionGasMisidentifies = &v
		}
	}
	return b
}

func Summarize(briefs []Brief) Summary {
	s := Summary{Blocks: len(briefs)}
	var gas, execution, validator, builder, v8, b8 []float64
	var timed, single, misidentified, verified, execTimed, execMisidentified int
	for i := range briefs {
		b := &briefs[i]
		if s.FromBlock == nil || b.BlockNumber < *s.FromBlock {
			s.FromBlock = &b.BlockNumber
		}
		if s.ToBlock == nil || b.BlockNumber > *s.ToBlock {
			s.ToBlock = &b.BlockNumber
		}
		gas, execution, validator, builder, v8, b8 = add(gas, b.GasWeighted), add(execution, b.ExecutionGasWeighted), add(validator, b.ValidatorBALTime), add(builder, b.BuilderDAGTime), add(v8, b.Speedup8Validator), add(b8, b.Speedup8Builder)
		if b.CommitmentVerified {
			verified++
		}
		if b.ValidatorCappingTx != nil && b.BuilderCriticalPathLength != nil {
			timed++
			if *b.BuilderCriticalPathLength == 1 {
				single++
			}
			// Briefs stored before the strict flag existed fall back to comparing capping indices (ties count).
			if b.GasMisidentifies != nil && *b.GasMisidentifies || b.GasMisidentifies == nil && (b.GasCappingTx == nil || *b.GasCappingTx != *b.ValidatorCappingTx) {
				misidentified++
			}
			if b.ExecutionGasMisidentifies != nil {
				execTimed++
				if *b.ExecutionGasMisidentifies {
					execMisidentified++
				}
			}
		}
	}
	s.Ceilings.Gas, s.Ceilings.Execution, s.Ceilings.Validator, s.Ceilings.Builder = percentiles(gas), percentiles(execution), percentiles(validator), percentiles(builder)
	s.SingleTxBound, s.GasMisidentifies, s.CommitmentVerified = share(single, timed), share(misidentified, timed), share(verified, len(briefs))
	s.ExecMisidentifies = share(execMisidentified, execTimed)
	if p := percentiles(v8); p != nil {
		s.Speedup8.Validator = &p.Median
	}
	if p := percentiles(b8); p != nil {
		s.Speedup8.Builder = &p.Median
	}
	return s
}

func add(list []float64, v *float64) []float64 {
	if v != nil {
		return append(list, *v)
	}
	return list
}
func share(k, n int) *float64 {
	if n == 0 {
		return nil
	}
	v := float64(k) / float64(n)
	return &v
}

// percentiles uses nearest rank, element ceil(n·p)-1 of the ascending values.
func percentiles(v []float64) *Percentiles {
	if len(v) == 0 {
		return nil
	}
	sort.Float64s(v)
	at := func(p float64) float64 { return v[max(0, int(math.Ceil(float64(len(v))*p))-1)] }
	return &Percentiles{P10: at(0.1), Median: at(0.5), P90: at(0.9)}
}
