package xray

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"rooted/internal/bal"
	"rooted/internal/ingest"
	"rooted/internal/profiler"
	"rooted/internal/uniswap"
)

type Inputs struct {
	Capture   profiler.Capture     // Block, Receipts, Traces (prestateTracer, non-diff); Ancestors unused
	Native    bal.Native           // bal.DecodeNativeRLP(envelope BAL, n, block.blockAccessListHash)
	Metrics   json.RawMessage      // rooted-native-replay-v1 output; nil => time views null
	Envelope  *Envelope            // nil allowed
	EPBS      *EPBS                // nil => coverage epbs_state_unavailable
	Uniswap   uniswap.BlockContext // zero value => no labels
	Source    string
	ProfileID string
	Now       time.Time
}

// System contracts (4788, 2935, 7002, 7251, system sender) and precompiles 0x01..0x11, 0x100.
var excludedFixed = func() map[string]bool {
	m := map[string]bool{"0x000f3df6d732807ef1319fb7b8bb8522d0beac02": true, "0x0000f90827f1c53a10cb7a02335b175320002935": true, "0x00000961ef480eb55e80d19ad83579a64c007002": true, "0x0000bbddc7ce488642fb579f8b00f3a590007251": true, "0xfffffffffffffffffffffffffffffffffffffffe": true, "0x0000000000000000000000000000000000000100": true}
	for i := 1; i <= 0x11; i++ {
		m[fmt.Sprintf("0x%040x", i)] = true
	}
	return m
}()

var alwaysCoverage = []string{"reads_are_prestate_superset", "non_sender_balance_reads_not_modeled", "excluded_fee_recipient_system_contracts_precompiles", "replay_is_warm_cache_sequential_apply_message", "state_root_io_and_bal_processing_excluded", "ceilings_are_upper_bounds"}

type rawBlock struct {
	Number       string  `json:"number"`
	Hash         string  `json:"hash"`
	ParentHash   string  `json:"parentHash"`
	Timestamp    string  `json:"timestamp"`
	Slot         *string `json:"slotNumber"`
	ParentRoot   string  `json:"parentBeaconBlockRoot"`
	Miner        string  `json:"miner"`
	GasLimit     string  `json:"gasLimit"`
	GasUsed      string  `json:"gasUsed"`
	BALHash      string  `json:"blockAccessListHash"`
	Transactions []struct {
		Hash string  `json:"hash"`
		From string  `json:"from"`
		To   *string `json:"to"`
	} `json:"transactions"`
}

func Compute(in Inputs) (Report, error) {
	var b rawBlock
	var receipts []struct {
		Hash    string        `json:"transactionHash"`
		Status  string        `json:"status"`
		GasUsed string        `json:"gasUsed"`
		Logs    []uniswap.Log `json:"logs"`
	}
	var traces []struct {
		Hash   string `json:"txHash"`
		Result map[string]struct {
			Storage map[string]string `json:"storage"`
		} `json:"result"`
	}
	if json.Unmarshal(in.Capture.Block, &b) != nil || !ingest.ValidRoot(b.Hash) {
		return Report{}, errors.New("capture block is missing or malformed")
	}
	n := len(b.Transactions)
	if n == 0 || n > 512 {
		return Report{}, errors.New("X-ray requires a nonempty block with at most 512 transactions")
	}
	if json.Unmarshal(in.Capture.Receipts, &receipts) != nil || len(receipts) != n || json.Unmarshal(in.Capture.Traces, &traces) != nil || len(traces) != n {
		return Report{}, errors.New("receipts or prestate traces do not cover every transaction")
	}
	switch in.Source {
	case "live", "profile", "capture", "follow":
	default:
		return Report{}, errors.New("invalid X-ray source")
	}
	r := Report{Schema: Schema, Network: "sepolia", ComputedAt: in.Now.UTC(), Source: in.Source, Transactions: make([]Tx, n), HotLocations: []Hot{}, Excluded: []string{}, Coverage: append([]string{}, alwaysCoverage...)}
	if in.Now.IsZero() {
		r.ComputedAt = time.Now().UTC()
	}
	if in.ProfileID != "" {
		r.ProfileID = &in.ProfileID
	}
	var err error
	number, e1 := bal.Number(b.Number)
	timestamp, e2 := bal.Number(b.Timestamp)
	gasLimit, e3 := bal.Number(b.GasLimit)
	headerGas, e4 := bal.Number(b.GasUsed)
	miner, e5 := bal.Address(b.Miner)
	if err = errors.Join(e1, e2, e3, e4, e5); err != nil {
		return Report{}, fmt.Errorf("invalid block header: %w", err)
	}
	r.Block = Block{Number: number, Hash: strings.ToLower(b.Hash), ParentHash: strings.ToLower(b.ParentHash), Timestamp: timestamp, ParentBeaconBlockRoot: strings.ToLower(b.ParentRoot), FeeRecipient: miner, GasLimit: gasLimit, TransactionCount: n}
	if b.Slot != nil {
		slot, err := bal.Number(*b.Slot)
		if err != nil {
			return Report{}, errors.New("invalid block slotNumber")
		}
		r.Block.Slot = &slot
	}
	if in.Envelope != nil {
		if r.Block.Slot != nil && *r.Block.Slot != in.Envelope.Slot {
			return Report{}, errors.New("payload envelope slot does not match the block")
		}
		slot, root := in.Envelope.Slot, in.Envelope.BeaconBlockRoot
		r.Block.Slot, r.Block.BeaconBlockRoot = &slot, &root
	}

	excluded := map[string]bool{miner: true}
	for a := range excludedFixed {
		excluded[a] = true
	}
	dropped := map[string]bool{}
	keep := func(address string) bool {
		if excluded[address] {
			dropped[address] = true
			return false
		}
		return true
	}

	hashes := make([]string, n)
	gas := make([]uint64, n)
	access := make([]bal.Access, n)
	for i, tx := range b.Transactions {
		hashes[i] = strings.ToLower(tx.Hash)
		if !ingest.ValidRoot(hashes[i]) || !strings.EqualFold(receipts[i].Hash, tx.Hash) || !strings.EqualFold(traces[i].Hash, tx.Hash) {
			return Report{}, fmt.Errorf("transaction %d identity differs across block, receipts and traces", i)
		}
		from, err := bal.Address(tx.From)
		if err != nil {
			return Report{}, fmt.Errorf("transaction %d sender: %w", i, err)
		}
		row := Tx{Index: i, Hash: hashes[i], From: from, IsCreate: tx.To == nil, DependsOn: []int{}}
		if tx.To != nil {
			to, err := bal.Address(*tx.To)
			if err != nil {
				return Report{}, fmt.Errorf("transaction %d recipient: %w", i, err)
			}
			row.To = &to
		}
		status, e1 := bal.Number(receipts[i].Status)
		used, e2 := bal.Number(receipts[i].GasUsed)
		if e1 != nil || e2 != nil || traces[i].Result == nil {
			return Report{}, fmt.Errorf("transaction %d receipt or prestate trace is malformed", i)
		}
		row.Status, row.GasUsed, gas[i] = status, used, used
		r.Gas.ReceiptsGasSum += used
		reads := map[bal.Location]bool{}
		if keep(from) {
			reads[bal.Location{Address: from, Field: "balance"}] = true
			reads[bal.Location{Address: from, Field: "nonce"}] = true
		}
		for address, account := range traces[i].Result {
			a, err := bal.Address(address)
			if err != nil {
				return Report{}, fmt.Errorf("transaction %d prestate address: %w", i, err)
			}
			if !keep(a) {
				continue
			}
			reads[bal.Location{Address: a, Field: "code"}] = true
			for key := range account.Storage {
				k, err := bal.Word(key)
				if err != nil {
					return Report{}, fmt.Errorf("transaction %d prestate key: %w", i, err)
				}
				reads[bal.Location{Address: a, Field: "storage", Key: k}] = true
			}
		}
		access[i] = bal.Access{Index: uint64(i), Hash: hashes[i], StorageReadsComplete: true}
		for l := range reads {
			access[i].Reads = append(access[i].Reads, l)
		}
		r.Transactions[i] = row
	}
	r.Gas.HeaderGasUsed, r.Gas.Differs = headerGas, headerGas != r.Gas.ReceiptsGasSum

	for _, c := range in.Native.Changes {
		if c.TransactionIndex != nil && *c.TransactionIndex >= uint64(n) {
			return Report{}, errors.New("BAL change index exceeds the block's transactions")
		}
	}
	for i, a := range bal.NativeAccess(in.Native, hashes) {
		for _, l := range a.Writes {
			if keep(l.Address) {
				access[i].Writes = append(access[i].Writes, l)
			}
		}
		r.Transactions[i].Reads, r.Transactions[i].Writes = len(access[i].Reads), len(access[i].Writes)
	}
	verified := in.Native.CommitmentVerified != nil && *in.Native.CommitmentVerified
	r.BAL = BAL{Commitment: strings.ToLower(b.BALHash), ComputedCommitment: in.Native.ComputedHash, CommitmentVerified: verified, Accounts: in.Native.Accounts, Source: "beacon_payload_envelope", Schema: in.Native.Schema}
	if !verified {
		r.Coverage = append(r.Coverage, "bal_commitment_unavailable")
	}

	var t []int64
	if in.Metrics != nil {
		if t, r.Replay, err = medians(in.Metrics, r.Block.Hash, hashes); err != nil {
			return Report{}, err
		}
		for i := range t {
			r.Transactions[i].ApplyNS = &t[i]
		}
	} else {
		r.Coverage = append(r.Coverage, "no_replay_metrics")
	}

	g := bal.BuildGraph(access, false, 100000)
	preds := make([][]int, n)
	seen := map[[2]uint64]bool{}
	for _, e := range g.Edges {
		if !seen[[2]uint64{e.From, e.To}] {
			seen[[2]uint64{e.From, e.To}] = true
			preds[e.To] = append(preds[e.To], int(e.From))
		}
	}
	for i := range preds {
		sort.Ints(preds[i])
		if len(preds[i]) == 0 {
			r.Independent++
		} else {
			r.Transactions[i].DependsOn = preds[i]
		}
	}
	r.Edges = Edges{RAW: g.ConflictCounts["RAW"], WAR: g.ConflictCounts["WAR"], WAW: g.ConflictCounts["WAW"], Total: len(g.Edges), DependentPairs: len(seen), Truncated: g.Truncated}
	if g.Truncated {
		r.Coverage = append(r.Coverage, "edge_limit_reached")
	}
	r.Ceilings.Gas, r.Ceilings.Validator, r.Ceilings.Builder = Ceilings(t, gas, preds)
	r.Schedules.Cores = Cores
	r.Schedules.Validator, r.Schedules.Builder = Speedups(t, preds, Cores)

	hotEdges(&r, g, in.Uniswap)
	v3, v4 := map[int]bool{}, map[int]bool{}
	for i, receipt := range receipts {
		for _, log := range receipt.Logs {
			if _, err := uniswap.DecodeSwap(log); err == nil {
				v3[i] = true
			}
			if _, err := uniswap.DecodeSwapV4(log); err == nil {
				v4[i] = true
			}
		}
	}
	r.Uniswap.V3Swaps, r.Uniswap.V4Swaps = len(v3), len(v4)
	for _, ok := range in.Uniswap.V3Pools {
		if !ok {
			r.Coverage = append(r.Coverage, "uniswap_v3_pools_unverified")
			break
		}
	}

	r.EPBS = in.EPBS
	if in.EPBS == nil {
		r.Coverage = append(r.Coverage, "epbs_state_unavailable")
		if in.Envelope != nil {
			r.EPBS = &EPBS{Slot: in.Envelope.Slot, BeaconBlockRoot: in.Envelope.BeaconBlockRoot, BuilderIndex: in.Envelope.BuilderIndex, Source: "envelope"}
		}
	}
	for a := range dropped {
		r.Excluded = append(r.Excluded, a)
	}
	sort.Strings(r.Excluded)
	return r, nil
}

// medians binds replay metrics to the block and takes the per-transaction median apply_ns.
func medians(raw json.RawMessage, hash string, hashes []string) ([]int64, *Replay, error) {
	if err := profiler.ValidateMetrics(raw, hash, len(hashes)); err != nil {
		return nil, nil, err
	}
	var m struct {
		Runner  string `json:"runner"`
		Geth    string `json:"geth_library"`
		CPU     string `json:"cpu_model"`
		CPUs    int    `json:"logical_cpus"`
		Median  int64  `json:"median_apply_ns"`
		Samples []struct {
			Transactions []struct {
				Hash  string `json:"hash"`
				Apply int64  `json:"apply_ns"`
			} `json:"transactions"`
		} `json:"samples"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, nil, err
	}
	t := make([]int64, len(hashes))
	values := make([]int64, len(m.Samples))
	for i, h := range hashes {
		for s, sample := range m.Samples {
			if sample.Transactions[i].Hash != "" && !strings.EqualFold(sample.Transactions[i].Hash, h) {
				return nil, nil, errors.New("replay metrics transaction order differs from the block")
			}
			values[s] = sample.Transactions[i].Apply
		}
		sort.Slice(values, func(a, b int) bool { return values[a] < values[b] })
		t[i] = values[(len(values)+1)/2-1]
	}
	return t, &Replay{Runner: m.Runner, GethLibrary: m.Geth, CPUModel: m.CPU, LogicalCPUs: m.CPUs, Samples: len(m.Samples), MedianNS: m.Median}, nil
}

// hotEdges ranks contended locations and counts Uniswap-labelled edges (labels cached per location).
func hotEdges(r *Report, g bal.Graph, ctx uniswap.BlockContext) {
	labels := map[string]*uniswap.Label{}
	label := func(l bal.Location) *uniswap.Label {
		id := l.ID()
		if v, ok := labels[id]; ok {
			return v
		}
		labels[id] = uniswap.LabelLocation(ctx, l.Address, l.Field, l.Key)
		return labels[id]
	}
	onPath := map[[2]uint64]bool{}
	path := r.Ceilings.Builder.CriticalPath
	for i := 1; i < len(path); i++ {
		onPath[[2]uint64{uint64(path[i-1]), uint64(path[i])}] = true
	}
	hot := map[string]*Hot{}
	for _, e := range g.Edges {
		id := e.Location.ID()
		h := hot[id]
		if h == nil {
			h = &Hot{Address: e.Location.Address, Field: e.Location.Field, Key: e.Location.Key}
			hot[id] = h
		}
		h.Edges++
		h.OnCriticalPath = h.OnCriticalPath || onPath[[2]uint64{e.From, e.To}]
		if label(e.Location) != nil {
			r.Uniswap.LabeledEdges++
		}
	}
	for _, s := range g.Hotspots {
		if h := hot[s.Location.ID()]; h != nil {
			h.Readers, h.Writers = s.Readers, s.Writers
		}
	}
	list := make([]*Hot, 0, len(hot))
	for _, h := range hot {
		list = append(list, h)
	}
	id := func(h *Hot) string { return bal.Location{Address: h.Address, Field: h.Field, Key: h.Key}.ID() }
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if a.Edges != b.Edges {
			return a.Edges > b.Edges
		}
		if a.Writers != b.Writers {
			return a.Writers > b.Writers
		}
		return id(a) < id(b)
	})
	for _, h := range list[:min(10, len(list))] {
		h.Label = label(bal.Location{Address: h.Address, Field: h.Field, Key: h.Key})
		r.HotLocations = append(r.HotLocations, *h)
	}
}
