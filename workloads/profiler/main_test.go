package main

import (
	"compress/gzip"
	"encoding/json"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/holiman/uint256"
	"math/big"
	"os"
	"strings"
	"testing"
)

func fixture(t *testing.T) Input {
	t.Helper()
	file, err := os.Open("../../demo/profiler/replay-input.json.gz")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	var in Input
	if err := json.NewDecoder(gz).Decode(&in); err != nil {
		t.Fatal(err)
	}
	return in
}
func TestRealCapturedBlockReplaysWithReconciledTimers(t *testing.T) {
	r, err := run(fixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if r.Transactions != 85 || len(r.Samples) != 7 || len(r.ControlNS) != 7 || r.MedianNS <= 0 || r.ControlMedianNS <= 0 {
		t.Fatal("missing benchmark coverage")
	}
	for _, s := range r.Samples {
		if s.State < 0 || s.State > s.Apply || s.EVM < s.EVMState || s.EVM > s.Apply || s.State < s.EVMState {
			t.Fatal("overlapping timing bounds")
		}
		var a, st, e, es, f int64
		for _, tx := range s.Transactions {
			a += tx.Apply
			st += tx.State
			e += tx.EVM
			es += tx.EVMState
			f += tx.Finalize
			var sum int64
			for _, c := range tx.StateCalls {
				sum += c.NS
			}
			if sum != tx.State {
				t.Fatal("state intervals double counted")
			}
		}
		if a != s.Apply || st != s.State || e != s.EVM || es != s.EVMState || f != s.Finalize {
			t.Fatal("transaction totals mismatch")
		}
	}
}
func TestReplayRejectsWrongIdentitiesStateAndReceipts(t *testing.T) {
	for _, mutate := range []func(*Input){
		func(in *Input) { in.Receipts[0] = nil },
		func(in *Input) { in.Traces[0].Hash = common.Hash{} },
		func(in *Input) { in.Receipts[0].Status ^= 1 },
		func(in *Input) { in.Ancestors = in.Ancestors[:255] },
		func(in *Input) {
			var block struct {
				Transactions []*types.Transaction `json:"transactions"`
			}
			if err := json.Unmarshal(in.Block, &block); err != nil {
				t.Fatal(err)
			}
			tx := block.Transactions[0]
			signer := types.LatestSignerForChainID(big.NewInt(11155111))
			sender, err := types.Sender(signer, tx)
			if err != nil {
				t.Fatal(err)
			}
			a := in.Traces[0].Result[sender]
			a.Nonce++
			in.Traces[0].Result[sender] = a
		},
	} {
		in := fixture(t)
		mutate(&in)
		if _, err := run(in); err == nil {
			t.Fatal("invalid capture produced measured results")
		}
	}
}

func TestInputRejectsTrailingOrOversizedJSON(t *testing.T) {
	for _, raw := range []string{"{} {}", "null null", "{", strings.Repeat(" ", 32<<20) + "{}"} {
		if _, err := decodeInput(strings.NewReader(raw)); err == nil {
			t.Fatal("invalid replay input accepted")
		}
	}
}
func TestStateDelegateTimersDoNotCountInnerNativeCallsTwice(t *testing.T) {
	db, err := state.New(types.EmptyRootHash, state.NewDatabaseForTesting())
	if err != nil {
		t.Fatal(err)
	}
	addr := common.Address{1}
	db.CreateAccount(addr)
	db.SetBalance(addr, uint256.NewInt(100), tracing.BalanceChangeUnspecified)
	s := &trackedState{StateDB: db, counts: map[string]Counter{}}
	s.AddBalance(addr, uint256.NewInt(1), tracing.BalanceChangeUnspecified)
	if s.counts["AddBalance"].Calls != 1 || s.counts["GetBalance"].Calls != 0 {
		t.Fatal("inner native calls double counted")
	}
	if s.elapsed != s.counts["AddBalance"].NS || s.elapsed < 0 {
		t.Fatal("interval sum mismatch")
	}
}
