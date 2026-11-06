// A standalone native Geth transaction-replay benchmark. No network or node access.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"os"
	"os/exec"
	"reflect"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/consensus/misc/eip4844"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/trie"
	"github.com/holiman/uint256"
)

type Account struct {
	Balance *hexutil.Big                `json:"balance"`
	Nonce   uint64                      `json:"nonce"`
	Code    hexutil.Bytes               `json:"code"`
	Storage map[common.Hash]common.Hash `json:"storage"`
}
type Trace struct {
	Hash   common.Hash                `json:"txHash"`
	Result map[common.Address]Account `json:"result"`
	Error  string                     `json:"error"`
}
type Input struct {
	Block     json.RawMessage   `json:"block"`
	Traces    []Trace           `json:"traces"`
	Receipts  []*types.Receipt  `json:"receipts"`
	Ancestors []json.RawMessage `json:"ancestors"`
}
type Tx struct {
	EVM        int64              `json:"evm_call_ns"`
	EVMState   int64              `json:"state_inside_evm_ns"`
	Hash       string             `json:"hash"`
	Gas        uint64             `json:"gas_used"`
	Apply      int64              `json:"apply_ns"`
	State      int64              `json:"state_access_ns"`
	Finalize   int64              `json:"finalize_ns"`
	StateCalls map[string]Counter `json:"state_calls"`
}
type Sample struct {
	EVM          int64 `json:"evm_call_ns"`
	EVMState     int64 `json:"state_inside_evm_ns"`
	Apply        int64 `json:"apply_ns"`
	State        int64 `json:"state_access_ns"`
	Finalize     int64 `json:"finalize_ns"`
	Transactions []Tx  `json:"transactions"`
}
type Counter struct {
	Calls uint64 `json:"calls"`
	NS    int64  `json:"ns"`
}
type Report struct {
	Runner           string   `json:"runner"`
	Go               string   `json:"go"`
	OS               string   `json:"os"`
	Arch             string   `json:"arch"`
	CPUs             int      `json:"logical_cpus"`
	CPU              string   `json:"cpu_model"`
	Geth             string   `json:"geth_library"`
	ModuleSum        string   `json:"module_sum"`
	BlockHash        string   `json:"block_hash"`
	Transactions     int      `json:"transaction_count"`
	Gas              uint64   `json:"gas_used"`
	Warmups          int      `json:"warmups"`
	Samples          []Sample `json:"samples"`
	ControlNS        []int64  `json:"control_apply_ns"`
	MedianNS         int64    `json:"median_apply_ns"`
	P95NS            int64    `json:"p95_apply_ns"`
	ControlMedianNS  int64    `json:"control_median_ns"`
	MedianStateNS    int64    `json:"median_state_ns"`
	MedianFinalizeNS int64    `json:"median_finalize_ns"`
}

func percentile(values []int64, p float64) int64 {
	v := append([]int64{}, values...)
	sort.Slice(v, func(i, j int) bool { return v[i] < v[j] })
	i := int(float64(len(v))*p+.999999) - 1
	if i < 0 {
		i = 0
	}
	if i >= len(v) {
		i = len(v) - 1
	}
	return v[i]
}
func cpuModel() string {
	if runtime.GOOS == "darwin" {
		b, e := exec.Command("sysctl", "-n", "machdep.cpu.brand_string").Output()
		if e == nil {
			return strings.TrimSpace(string(b))
		}
	}
	if b, e := os.ReadFile("/proc/cpuinfo"); e == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "model name") {
				return strings.TrimSpace(strings.SplitN(line, ":", 2)[1])
			}
		}
	}
	return "unknown"
}
func run(in Input) (Report, error) {
	var h types.Header
	if err := json.Unmarshal(in.Block, &h); err != nil {
		return Report{}, err
	}
	var block struct {
		Hash         common.Hash          `json:"hash"`
		Transactions []*types.Transaction `json:"transactions"`
	}
	if err := json.Unmarshal(in.Block, &block); err != nil {
		return Report{}, err
	}
	if h.Difficulty == nil || h.Difficulty.Sign() != 0 {
		return Report{}, fmt.Errorf("only post-Merge Sepolia blocks are supported")
	}
	n := len(block.Transactions)
	if n == 0 || n > 512 || len(in.Traces) != n || len(in.Receipts) != n {
		return Report{}, fmt.Errorf("expected 1–512 transactions with complete receipt/prestate coverage")
	}
	if h.Hash() != block.Hash {
		return Report{}, fmt.Errorf("execution header hash mismatch")
	}
	var receiptGas uint64
	for i, tx := range block.Transactions {
		if tx == nil || in.Receipts[i] == nil || in.Traces[i].Hash != tx.Hash() || len(in.Traces[i].Result) == 0 || in.Traces[i].Error != "" || in.Receipts[i].TxHash != tx.Hash() || in.Receipts[i].BlockHash != block.Hash || in.Receipts[i].TransactionIndex != uint(i) {
			return Report{}, fmt.Errorf("transaction/trace/receipt identity mismatch at %d", i)
		}
		receiptGas += in.Receipts[i].GasUsed
		if receiptGas != in.Receipts[i].CumulativeGasUsed {
			return Report{}, fmt.Errorf("receipt cumulative gas mismatch")
		}
	}
	if types.DeriveSha(types.Receipts(in.Receipts), trie.NewStackTrie(nil)) != h.ReceiptHash {
		return Report{}, fmt.Errorf("receipt root mismatch")
	}
	if types.DeriveSha(types.Transactions(block.Transactions), trie.NewStackTrie(nil)) != h.TxHash {
		return Report{}, fmt.Errorf("transaction root mismatch")
	}
	// Verify the complete historical BLOCKHASH environment against this parent chain.
	hashes := map[uint64]common.Hash{}
	parent := h.ParentHash
	number := h.Number.Uint64()
	for i, raw := range in.Ancestors {
		var a types.Header
		var id struct {
			Hash common.Hash `json:"hash"`
		}
		if json.Unmarshal(raw, &a) != nil || json.Unmarshal(raw, &id) != nil || a.Number == nil || number <= uint64(i) || a.Number.Uint64() != number-uint64(i)-1 || a.Hash() != id.Hash || id.Hash != parent {
			return Report{}, fmt.Errorf("ancestor chain mismatch")
		}
		hashes[a.Number.Uint64()] = id.Hash
		parent = a.ParentHash
	}
	required := uint64(256)
	if number < required {
		required = number
	}
	if uint64(len(in.Ancestors)) != required {
		return Report{}, fmt.Errorf("complete BLOCKHASH environment required")
	}
	chain := params.SepoliaChainConfig
	blockCtx := vm.BlockContext{CanTransfer: core.CanTransfer, Transfer: core.Transfer, GetHash: func(n uint64) common.Hash { return hashes[n] }, Coinbase: h.Coinbase, GasLimit: h.GasLimit, BlockNumber: h.Number, Time: h.Time, Difficulty: h.Difficulty, BaseFee: h.BaseFee, Random: &h.MixDigest, CostPerStateByte: params.CostPerStateByte}
	if h.SlotNumber != nil {
		blockCtx.SlotNum = *h.SlotNumber
	}
	if h.ExcessBlobGas != nil {
		blockCtx.BlobBaseFee = eip4844.CalcBlobFee(chain, &h)
	} else {
		blockCtx.BlobBaseFee = big.NewInt(0)
	}
	rules := chain.Rules(h.Number, true, h.Time)
	// Each earliest account field / storage key is the value before its first
	// touched transaction. Later traces must not overwrite that initial value.
	accounts := map[common.Address]Account{}
	for _, trace := range in.Traces {
		for addr, a := range trace.Result {
			old, ok := accounts[addr]
			if !ok {
				old = a
				old.Storage = map[common.Hash]common.Hash{}
			}
			for key, value := range a.Storage {
				if _, seen := old.Storage[key]; !seen {
					old.Storage[key] = value
				}
			}
			accounts[addr] = old
		}
	}
	database := state.NewDatabaseForTesting()
	seed, err := state.New(types.EmptyRootHash, database)
	if err != nil {
		return Report{}, err
	}
	for addr, a := range accounts {
		seed.CreateAccount(addr)
		if a.Balance != nil {
			v, overflow := uint256.FromBig((*big.Int)(a.Balance))
			if overflow {
				return Report{}, fmt.Errorf("balance overflow")
			}
			seed.SetBalance(addr, v, tracing.BalanceChangeUnspecified)
		}
		seed.SetNonce(addr, a.Nonce, tracing.NonceChangeUnspecified)
		seed.SetCode(addr, a.Code, tracing.CodeChangeUnspecified)
		for key, value := range a.Storage {
			seed.SetState(addr, key, value)
		}
	}
	root, err := seed.Commit(rules, number)
	if err != nil {
		return Report{}, err
	}
	baseline, err := state.New(root, database)
	if err != nil {
		return Report{}, err
	}
	signer := types.MakeSigner(chain, h.Number, h.Time)
	messages := make([]*core.Message, n)
	for i, tx := range block.Transactions {
		messages[i], err = core.TransactionToMessage(tx, signer, h.BaseFee)
		if err != nil {
			return Report{}, err
		}
	}
	replay := func(instrumented bool) (Sample, error) {
		// Restore before every sample. Reset/copy is outside timed boundaries.
		db := baseline.Copy()
		counter := &trackedState{StateDB: db, counts: map[string]Counter{}}
		var stateDB vm.StateDB = db
		if instrumented {
			stateDB = counter
		}
		gp := core.NewGasPool(h.GasLimit)
		sample := Sample{Transactions: []Tx{}}
		for i, tx := range block.Transactions {
			db.SetTxContext(tx.Hash(), i, uint32(i+1))
			counter.counts = map[string]Counter{}
			counter.elapsed = 0
			counter.evmState = 0
			counter.inEVM = false
			var evmStart time.Time
			var evmNS int64
			config := vm.Config{}
			if instrumented {
				config.Tracer = &tracing.Hooks{
					OnEnter: func(depth int, _ byte, _, _ common.Address, _ []byte, _ uint64, _ *big.Int) {
						if depth == 0 {
							evmStart = time.Now()
							counter.inEVM = true
						}
					},
					OnExit: func(depth int, _ []byte, _ uint64, _ error, _ bool) {
						if depth == 0 {
							evmNS += time.Since(evmStart).Nanoseconds()
							counter.inEVM = false
						}
					},
				}
			}
			evm := vm.NewEVM(blockCtx, stateDB, chain, config)
			evm.SetTxContext(core.NewEVMTxContext(messages[i]))
			start := time.Now()
			result, err := core.ApplyMessage(evm, messages[i], gp)
			elapsed := time.Since(start).Nanoseconds()
			if err != nil {
				return Sample{}, fmt.Errorf("replay tx %d: %w", i, err)
			}
			status := uint64(1)
			if result.Failed() {
				status = 0
			}
			if result.UsedGas != in.Receipts[i].GasUsed || status != in.Receipts[i].Status {
				return Sample{}, fmt.Errorf("replay tx %d gas/status differ: %d/%d versus %d/%d", i, result.UsedGas, status, in.Receipts[i].GasUsed, in.Receipts[i].Status)
			}
			// Finalization is a disjoint timer; no state root hashing or persistent commit.
			start = time.Now()
			db.Finalise(rules)
			finalize := time.Since(start).Nanoseconds()
			actual := db.GetLogs(tx.Hash(), number, block.Hash, h.Time)
			if !sameLogs(actual, in.Receipts[i].Logs) {
				return Sample{}, fmt.Errorf("replay tx %d logs differ", i)
			}
			if counter.inEVM || evmNS > elapsed || counter.evmState > evmNS || elapsed-evmNS-(counter.elapsed-counter.evmState) < 0 {
				return Sample{}, fmt.Errorf("overlapping or incomplete root EVM timers")
			}
			sample.EVM += evmNS
			sample.EVMState += counter.evmState
			sample.Apply += elapsed
			sample.State += counter.elapsed
			sample.Finalize += finalize
			sample.Transactions = append(sample.Transactions, Tx{EVM: evmNS, EVMState: counter.evmState, Hash: tx.Hash().Hex(), Gas: result.UsedGas, Apply: elapsed, State: counter.elapsed, Finalize: finalize, StateCalls: counter.counts})
		}
		if gp.Used() != h.GasUsed {
			return Sample{}, fmt.Errorf("replayed block gas dimensions differ from header")
		}
		return sample, nil
	}
	for i := 0; i < 2; i++ {
		if _, err := replay(false); err != nil {
			return Report{}, err
		}
		if _, err := replay(true); err != nil {
			return Report{}, err
		}
	}
	report := Report{Runner: "rooted-native-replay-v1", Go: runtime.Version(), OS: runtime.GOOS, Arch: runtime.GOARCH, CPUs: runtime.NumCPU(), CPU: cpuModel(), Geth: "v1.17.10", BlockHash: block.Hash.Hex(), Transactions: n, Gas: h.GasUsed, Warmups: 2, Samples: []Sample{}, ControlNS: []int64{}}
	if build, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range build.Deps {
			if dep.Path == "github.com/ethereum/go-ethereum" {
				report.Geth = dep.Version
				report.ModuleSum = dep.Sum
			}
		}
	}
	apply, stateTime, finalize := []int64{}, []int64{}, []int64{}
	// Alternate control/instrumented order to reduce one-sided cache-order bias.
	for i := 0; i < 7; i++ {
		var control, sample Sample
		var err error
		if i%2 == 0 {
			control, err = replay(false)
			if err == nil {
				sample, err = replay(true)
			}
		} else {
			sample, err = replay(true)
			if err == nil {
				control, err = replay(false)
			}
		}
		if err != nil {
			return Report{}, err
		}
		report.ControlNS = append(report.ControlNS, control.Apply)
		report.Samples = append(report.Samples, sample)
		apply = append(apply, sample.Apply)
		stateTime = append(stateTime, sample.State)
		finalize = append(finalize, sample.Finalize)
	}
	report.MedianNS = percentile(apply, .5)
	report.P95NS = percentile(apply, .95)
	report.ControlMedianNS = percentile(report.ControlNS, .5)
	report.MedianStateNS = percentile(stateTime, .5)
	report.MedianFinalizeNS = percentile(finalize, .5)
	return report, nil
}
func sameLogs(a, b []*types.Log) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Address != b[i].Address || !bytes.Equal(a[i].Data, b[i].Data) || !reflect.DeepEqual(a[i].Topics, b[i].Topics) {
			return false
		}
	}
	return true
}
func decodeInput(reader io.Reader) (Input, error) {
	var in Input
	raw, err := io.ReadAll(io.LimitReader(reader, (32<<20)+1))
	if err != nil || len(raw) > 32<<20 {
		return in, fmt.Errorf("invalid replay input size")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&in); err != nil {
		return in, fmt.Errorf("invalid replay input")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return in, fmt.Errorf("provide one replay input")
	}
	return in, nil
}
func main() {
	in, err := decodeInput(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "invalid replay input")
		os.Exit(1)
	}
	report, err := run(in)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	_ = json.NewEncoder(os.Stdout).Encode(report)
}
