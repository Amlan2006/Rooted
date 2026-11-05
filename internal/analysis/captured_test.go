package analysis

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"rooted/internal/bal"
	"rooted/internal/uniswap"
	"testing"
)

func TestCapturedForkTracesAndUniswap(t *testing.T) {
	dir := filepath.Join("..", "..", "demo", "phase5", "reference")
	file, err := os.Open(filepath.Join(dir, "fork-evidence.json.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	var evidence []Evidence
	if err = json.NewDecoder(gz).Decode(&evidence); err != nil {
		t.Fatal(err)
	}
	records := map[string]json.RawMessage{}
	for _, e := range evidence {
		var response struct {
			Result json.RawMessage `json:"result"`
		}
		if err = json.Unmarshal(e.Body, &response); err != nil {
			t.Fatal(err)
		}
		records[e.Kind] = response.Result
	}
	raw, err := os.ReadFile(filepath.Join(dir, "fork-analysis.json"))
	if err != nil {
		t.Fatal(err)
	}
	var report Run
	if err = json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	access := []bal.Access{}
	swaps, attempts, reverted := 0, 0, 0
	for _, tx := range report.Block.Transactions {
		var receipt Receipt
		if err = json.Unmarshal(records["eth_getTransactionReceipt:"+tx.Hash], &receipt); err != nil {
			t.Fatal(err)
		}
		index, err := bal.Number(tx.Index)
		if err != nil {
			t.Fatal(err)
		}
		a := bal.Access{Index: index, Hash: tx.Hash}
		if err = bal.AddGethDiff(&a, records["debug_traceTransaction:diff:"+tx.Hash]); err != nil {
			t.Fatal(err)
		}
		if err = bal.AddOpcodes(&a, records["debug_traceTransaction:opcodes:"+tx.Hash], *tx.To, 20000); err != nil {
			t.Fatal(err)
		}
		if !a.StorageReadsComplete || len(a.Reads) < 10 {
			t.Fatal("missing actual storage reads", a)
		}
		if receipt.Status == "0x0" {
			for _, w := range a.Writes {
				if w.Field == "storage" {
					t.Fatal("reverted storage write committed")
				}
			}
		}
		access = append(access, a)
		var calls uniswap.Call
		if err = json.Unmarshal(records["debug_traceTransaction:calls:"+tx.Hash], &calls); err != nil {
			t.Fatal(err)
		}
		decoded := uniswap.Attempts(calls, tx.Hash, receipt.Status == "0x0")
		attempts += len(decoded)
		for _, call := range decoded {
			if call.TransactionReverted {
				reverted++
				if call.Committed || !call.AncestorFailed {
					t.Fatal(call)
				}
			}
		}
		for _, log := range receipt.Logs {
			if len(log.Topics) > 0 && log.Topics[0] == uniswap.SwapTopic {
				if _, err = uniswap.DecodeSwap(log); err != nil {
					t.Fatal(err)
				}
				swaps++
			}
		}
	}
	if swaps != 3 || attempts != 4 || reverted != 1 {
		t.Fatalf("swaps=%d attempts=%d reverted=%d", swaps, attempts, reverted)
	}
	graph := bal.BuildGraph(access, false, 100000)
	for kind, count := range report.Graph.ConflictCounts {
		if graph.ConflictCounts[kind] != count {
			t.Fatalf("%s count %d != %d", kind, graph.ConflictCounts[kind], count)
		}
	}
	if graph.Complete || graph.TheoreticalSpeedup != nil {
		t.Fatal("invented complete dependency coverage")
	}
}
