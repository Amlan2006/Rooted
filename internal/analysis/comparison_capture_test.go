package analysis

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"rooted/internal/bal"
	"testing"
)

// Rebuild both recorded graphs from actual RPC responses without Anvil, a node,
// PostgreSQL, or network access. This detects drift beyond a UI count fixture.
func TestControlledComparisonCapturedEvidence(t *testing.T) {
	file, err := os.Open(filepath.Join("..", "..", "demo", "phase5", "reference", "workload-comparison", "evidence.json.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	var archive []struct {
		ID      string     `json:"report_id"`
		Records []Evidence `json:"records"`
	}
	if err := json.NewDecoder(gz).Decode(&archive); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "demo", "phase5", "reference", "workload-comparison", "workload-comparison.json"))
	if err != nil {
		t.Fatal(err)
	}
	var bundle struct {
		Scenarios []struct {
			Report Run `json:"report"`
		} `json:"scenarios"`
	}
	if err := json.Unmarshal(raw, &bundle); err != nil {
		t.Fatal(err)
	}
	if len(archive) != 2 || len(bundle.Scenarios) != 2 {
		t.Fatal("expected two real fork scenarios")
	}
	for i, capture := range archive {
		run := bundle.Scenarios[i].Report
		if capture.ID != run.ID {
			t.Fatal("report identity mismatch")
		}
		records := map[string]json.RawMessage{}
		for _, e := range capture.Records {
			var response struct {
				Result json.RawMessage `json:"result"`
			}
			if err := json.Unmarshal(e.Body, &response); err != nil {
				t.Fatal(err)
			}
			records[e.Kind] = response.Result
		}
		var block Block
		if err := json.Unmarshal(records["eth_getBlockByHash:"+run.Block.Hash], &block); err != nil {
			t.Fatal(err)
		}
		if block.Hash != run.Block.Hash || len(block.Transactions) != 3 {
			t.Fatal("block binding mismatch")
		}
		access := []bal.Access{}
		for _, tx := range block.Transactions {
			var receipt Receipt
			if err := json.Unmarshal(records["eth_getTransactionReceipt:"+tx.Hash], &receipt); err != nil {
				t.Fatal(err)
			}
			if receipt.Hash != tx.Hash || receipt.BlockHash != block.Hash || receipt.Status != "0x1" {
				t.Fatal("receipt binding mismatch")
			}
			index, err := bal.Number(tx.Index)
			if err != nil {
				t.Fatal(err)
			}
			a := bal.Access{Index: index, Hash: tx.Hash}
			if err := bal.AddPrestate(&a, records["debug_traceTransaction:prestate:"+tx.Hash]); err != nil {
				t.Fatal(err)
			}
			if err := bal.AddGethDiff(&a, records["debug_traceTransaction:diff:"+tx.Hash]); err != nil {
				t.Fatal(err)
			}
			if tx.To == nil {
				t.Fatal("missing root contract")
			}
			if err := bal.AddOpcodes(&a, records["debug_traceTransaction:opcodes:"+tx.Hash], *tx.To, 20000); err != nil {
				t.Fatal(err)
			}
			if !a.StorageReadsComplete {
				t.Fatal("incomplete opcode capture")
			}
			access = append(access, a)
		}
		for _, storage := range []bool{false, true} {
			graph := bal.BuildGraph(access, storage, 100000)
			expected := run.Graph
			if storage {
				expected = run.StorageGraph
			}
			if !reflect.DeepEqual(graph.Edges, expected.Edges) || !reflect.DeepEqual(graph.ConflictCounts, expected.ConflictCounts) || graph.Depth != expected.Depth || graph.Width != expected.Width {
				t.Fatalf("scenario %d storage=%v: captured graph differs", i, storage)
			}
			if graph.Complete || graph.TheoreticalSpeedup != nil {
				t.Fatal("invented measured performance or full coverage")
			}
		}
	}
}
