package xray

import "sort"

// Ceilings returns the three upper bounds. preds[i] lists lower-index predecessors of i.
// A nil t (no replay metrics) leaves both time views unavailable. Ties pick the smallest index.
func Ceilings(t []int64, g []uint64, preds [][]int) (gas, validator, builder Ceiling) {
	gas = Ceiling{Model: "validator_bal", Weight: "gas"}
	validator = Ceiling{Model: "validator_bal", Weight: "ns"}
	builder = Ceiling{Model: "builder_dag", Weight: "ns"}
	gw := make([]int64, len(g))
	for i, v := range g {
		gw[i] = int64(v)
	}
	amdahl(&gas, gw)
	if t == nil {
		return
	}
	amdahl(&validator, t)
	dp := make([]int64, len(t))
	from := make([]int, len(t))
	end := -1
	for i := range t {
		from[i] = -1
		for _, p := range preds[i] {
			if from[i] < 0 || dp[p] > dp[from[i]] || (dp[p] == dp[from[i]] && p < from[i]) {
				from[i] = p
			}
		}
		dp[i] = t[i]
		if from[i] >= 0 {
			dp[i] += dp[from[i]]
		}
		if end < 0 || dp[i] > dp[end] {
			end = i
		}
	}
	if end < 0 || dp[end] <= 0 {
		return
	}
	path := []int{}
	for i := end; i >= 0; i = from[i] {
		path = append([]int{i}, path...)
	}
	capping := path[0]
	for _, i := range path {
		if t[i] > t[capping] || (t[i] == t[capping] && i < capping) {
			capping = i
		}
	}
	total, bottleneck := sum(t), dp[end]
	value := float64(total) / float64(bottleneck)
	builder.Value, builder.Total, builder.Bottleneck, builder.CappingTx, builder.CriticalPath = &value, &total, &bottleneck, &capping, path
	return
}

// amdahl fills sum/max with the first argmax as the capping transaction.
func amdahl(c *Ceiling, w []int64) {
	capping := -1
	for i, v := range w {
		if capping < 0 || v > w[capping] {
			capping = i
		}
	}
	if capping < 0 || w[capping] <= 0 {
		return
	}
	total, bottleneck := sum(w), w[capping]
	value := float64(total) / float64(bottleneck)
	c.Value, c.Total, c.Bottleneck, c.CappingTx = &value, &total, &bottleneck, &capping
}

func sum(w []int64) int64 {
	var s int64
	for _, v := range w {
		s += v
	}
	return s
}

// Speedups returns Σt/makespan per core count: LPT for validators (no dependencies with a BAL),
// bottom-level list scheduling over the conflict DAG for builders.
func Speedups(t []int64, preds [][]int, cores []int) (validator, builder []float64) {
	total := float64(sum(t))
	if t == nil || total <= 0 {
		return nil, nil
	}
	succ := make([][]int, len(t))
	for i, ps := range preds {
		for _, p := range ps {
			succ[p] = append(succ[p], i)
		}
	}
	bottom := make([]int64, len(t))
	for i := len(t) - 1; i >= 0; i-- {
		var best int64
		for _, s := range succ[i] {
			best = max(best, bottom[s])
		}
		bottom[i] = t[i] + best
	}
	byTime, byBottom := order(t), order(bottom)
	for _, k := range cores {
		load := make([]int64, k)
		for _, i := range byTime {
			load[earliest(load)] += t[i]
		}
		validator = append(validator, total/float64(load[latest(load)]))
		free := make([]int64, k)
		finish := make([]int64, len(t))
		var makespan int64
		for _, i := range byBottom {
			c := earliest(free)
			start := free[c]
			for _, p := range preds[i] {
				start = max(start, finish[p])
			}
			finish[i] = start + t[i]
			free[c] = finish[i]
			makespan = max(makespan, finish[i])
		}
		builder = append(builder, total/float64(makespan))
	}
	return validator, builder
}

// order sorts indices by weight descending, index ascending.
func order(w []int64) []int {
	idx := make([]int, len(w))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return w[idx[a]] > w[idx[b]] })
	return idx
}
func earliest(v []int64) int {
	best := 0
	for i := range v {
		if v[i] < v[best] {
			best = i
		}
	}
	return best
}
func latest(v []int64) int {
	best := 0
	for i := range v {
		if v[i] > v[best] {
			best = i
		}
	}
	return best
}
