package xray

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"rooted/internal/bal"
	"rooted/internal/profiler"
)

const (
	miner  = "0x1111111111111111111111111111111111111111"
	alice  = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	bob    = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	pool   = "0xcccccccccccccccccccccccccccccccccccccccc"
	deploy = "0xdddddddddddddddddddddddddddddddddddddddd"
	beacon = "0x000f3df6d732807ef1319fb7b8bb8522d0beac02"
	pre0a  = "0x000000000000000000000000000000000000000a"
	p256   = "0x0000000000000000000000000000000000000100"
)

func h(c string) string { return "0x" + strings.Repeat(c, 64) }

// synthetic: tx0 alice->pool writes pool slot 1, tx1 alice->pool reads it (same sender), tx2 bob creates a contract.
// Coinbase, 0x0a, 0x100 and the 4788 contract are touched by tx0 and tx1 and must never produce edges.
func synthetic(t *testing.T) (profiler.Capture, bal.Native) {
	t.Helper()
	change := func(index, value string) []bal.RPCChange { return []bal.RPCChange{{Index: index, Value: value}} }
	accounts := []bal.Account{
		{Address: pre0a, Balance: append(change("0x1", "0x1"), change("0x2", "0x2")...)},
		{Address: p256, Balance: append(change("0x1", "0x1"), change("0x2", "0x2")...)},
		{Address: beacon, Storage: []bal.Slot{{Key: "0x5", Changes: append(change("0x1", "0x1"), change("0x2", "0x2")...)}}},
		{Address: miner, Balance: append(change("0x1", "0x10"), change("0x2", "0x20")...)},
		{Address: alice, Balance: append(change("0x1", "0x9"), change("0x2", "0x8")...), Nonce: append(change("0x1", "0x1"), change("0x2", "0x2")...)},
		{Address: bob, Nonce: change("0x3", "0x1")},
		{Address: pool, Storage: []bal.Slot{{Key: "0x1", Changes: change("0x1", "0x7")}}},
		{Address: deploy, Nonce: change("0x3", "0x1"), Code: []bal.CodeChange{{Index: "0x3", Code: "0x6000"}}},
	}
	slices.SortFunc(accounts, func(a, b bal.Account) int { return strings.Compare(a.Address, b.Address) })
	for i := range accounts {
		accounts[i].Reads = []string{}
		for _, f := range []*[]bal.RPCChange{&accounts[i].Balance, &accounts[i].Nonce} {
			if *f == nil {
				*f = []bal.RPCChange{}
			}
		}
		if accounts[i].Storage == nil {
			accounts[i].Storage = []bal.Slot{}
		}
		if accounts[i].Code == nil {
			accounts[i].Code = []bal.CodeChange{}
		}
	}
	raw, _ := json.Marshal(accounts)
	unverified, err := bal.DecodeNative(raw, 3, "")
	if err != nil {
		t.Fatal(err)
	}
	native, err := bal.DecodeNative(raw, 3, unverified.ComputedHash)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := json.Marshal(map[string]any{"number": "0x10", "hash": h("b"), "parentHash": h("a"), "timestamp": "0x64", "slotNumber": "0x20", "parentBeaconBlockRoot": h("e"), "miner": miner, "gasLimit": "0x1c9c380", "gasUsed": "0x1", "blockAccessListHash": native.ComputedHash,
		"transactions": []map[string]any{{"hash": h("1"), "from": alice, "to": pool}, {"hash": h("2"), "from": alice, "to": pool}, {"hash": h("3"), "from": bob, "to": nil}}})
	receipts, _ := json.Marshal([]map[string]any{{"transactionHash": h("1"), "status": "0x1", "gasUsed": "0x5208", "logs": []any{}}, {"transactionHash": h("2"), "status": "0x1", "gasUsed": "0xc350", "logs": []any{}}, {"transactionHash": h("3"), "status": "0x1", "gasUsed": "0x186a0", "logs": []any{}}})
	touched := map[string]any{alice: map[string]any{"balance": "0x9"}, pool: map[string]any{"storage": map[string]string{"0x1": "0x0"}}, miner: map[string]any{}, pre0a: map[string]any{}, p256: map[string]any{}, beacon: map[string]any{"storage": map[string]string{"0x5": "0x0"}}}
	traces, _ := json.Marshal([]map[string]any{{"txHash": h("1"), "result": touched}, {"txHash": h("2"), "result": touched}, {"txHash": h("3"), "result": map[string]any{bob: map[string]any{}}}})
	return profiler.Capture{Block: block, Receipts: receipts, Traces: traces}, native
}

// metrics builds a valid rooted-native-replay-v1 document whose sample s times transaction i at base[i]+s.
func metrics(hash string, base []int64) json.RawMessage {
	samples := []map[string]any{}
	for s := int64(0); s < 7; s++ {
		txs, total := []map[string]any{}, int64(0)
		for _, b := range base {
			txs = append(txs, map[string]any{"evm_call_ns": 0, "state_inside_evm_ns": 0, "apply_ns": b + s, "state_access_ns": 0, "finalize_ns": 0})
			total += b + s
		}
		samples = append(samples, map[string]any{"evm_call_ns": 0, "state_inside_evm_ns": 0, "apply_ns": total, "state_access_ns": 0, "finalize_ns": 0, "transactions": txs})
	}
	raw, _ := json.Marshal(map[string]any{"runner": "rooted-native-replay-v1", "geth_library": "v1.17.10", "cpu_model": "test", "logical_cpus": 2, "block_hash": hash, "transaction_count": len(base), "median_apply_ns": 600, "control_median_ns": 600, "samples": samples, "control_apply_ns": []int64{1, 1, 1, 1, 1, 1, 1}})
	return raw
}

func TestComputeSynthetic(t *testing.T) {
	capture, native := synthetic(t)
	r, err := Compute(Inputs{Capture: capture, Native: native, Metrics: metrics(h("b"), []int64{100, 300, 200}), Envelope: &Envelope{Slot: 32, BeaconBlockRoot: h("f"), BuilderIndex: "7"}, Source: "capture"})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(r.Excluded, []string{pre0a, p256, beacon, miner}) {
		t.Fatalf("excluded %v", r.Excluded)
	}
	for _, hot := range r.HotLocations {
		if slices.Contains(r.Excluded, hot.Address) {
			t.Fatalf("excluded address produced an edge: %+v", hot)
		}
	}
	if !slices.Equal(r.Transactions[1].DependsOn, []int{0}) || len(r.Transactions[2].DependsOn) != 0 || r.Independent != 2 || r.Edges.DependentPairs != 1 {
		t.Fatalf("dependencies %+v", r.Transactions)
	}
	nonce := false
	for _, hot := range r.HotLocations {
		nonce = nonce || (hot.Address == alice && hot.Field == "nonce")
	}
	if !nonce || r.Edges.RAW == 0 {
		t.Fatalf("same-sender nonce RAW missing: %+v %+v", r.Edges, r.HotLocations)
	}
	if !r.Transactions[2].IsCreate || r.Transactions[2].To != nil || r.Transactions[0].IsCreate || !r.Gas.Differs || r.Gas.ReceiptsGasSum != 171000 || !r.BAL.CommitmentVerified {
		t.Fatalf("tx/gas/bal fields %+v %+v %+v", r.Transactions[2], r.Gas, r.BAL)
	}
	// median of base+0..6 is base+3; gas caps tx2 while measured time caps tx1.
	if *r.Transactions[1].ApplyNS != 303 || *r.Ceilings.Gas.CappingTx != 2 || *r.Ceilings.Validator.CappingTx != 1 || !near(*r.Ceilings.Validator.Value, 609.0/303) || !near(*r.Ceilings.Builder.Value, 1.5) || !slices.Equal(r.Ceilings.Builder.CriticalPath, []int{0, 1}) {
		t.Fatalf("ceilings %+v", r.Ceilings)
	}
	if r.EPBS == nil || r.EPBS.Source != "envelope" || r.EPBS.BuilderIndex != "7" || *r.Block.Slot != 32 || !slices.Contains(r.Coverage, "epbs_state_unavailable") || slices.Contains(r.Coverage, "no_replay_metrics") {
		t.Fatalf("epbs %+v coverage %v", r.EPBS, r.Coverage)
	}
	if b := BriefOf(r); *b.Speedup8Validator != r.Schedules.Validator[3] || *b.BuilderCriticalPathLength != 2 || *b.BuilderIndex != "7" {
		t.Fatalf("brief %+v", b)
	}
}

func TestComputeWithoutMetricsAndMismatches(t *testing.T) {
	capture, native := synthetic(t)
	r, err := Compute(Inputs{Capture: capture, Native: native, Source: "live"})
	if err != nil {
		t.Fatal(err)
	}
	if r.Ceilings.Validator.Value != nil || r.Ceilings.Builder.Value != nil || r.Schedules.Validator != nil || r.Schedules.Builder != nil || r.Ceilings.Gas.Value == nil || !slices.Contains(r.Coverage, "no_replay_metrics") || r.Transactions[0].ApplyNS != nil {
		t.Fatalf("nil metrics must null time views: %+v", r.Ceilings)
	}
	bad := capture
	bad.Receipts = json.RawMessage(strings.Replace(string(capture.Receipts), h("2"), h("9"), 1))
	if _, err := Compute(Inputs{Capture: bad, Native: native, Source: "live"}); err == nil {
		t.Fatal("receipt identity mismatch accepted")
	}
	if _, err := Compute(Inputs{Capture: capture, Native: native, Metrics: metrics(h("c"), []int64{1, 2, 3}), Source: "live"}); err == nil {
		t.Fatal("metrics bound to another block accepted")
	}
	if _, err := Compute(Inputs{Capture: capture, Native: native, Metrics: metrics(h("b"), []int64{1, 2}), Source: "live"}); err == nil {
		t.Fatal("metrics transaction count mismatch accepted")
	}
	if _, err := Compute(Inputs{Capture: capture, Native: native, Source: "other"}); err == nil {
		t.Fatal("unknown source accepted")
	}
	if _, err := Compute(Inputs{Capture: capture, Native: native, Envelope: &Envelope{Slot: 33}, Source: "live"}); err == nil {
		t.Fatal("envelope slot mismatch accepted")
	}
}
