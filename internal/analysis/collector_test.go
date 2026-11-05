package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"rooted/internal/domain"
	"strings"
	"testing"
	"time"
)

const testAnchor = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const testBlock = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const testTx = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"

type rpcFake struct {
	chain, anchor          string
	badReceipt, badBinding bool
}

func (f rpcFake) RPC(_ context.Context, method string, params []any) (domain.RawRecord, error) {
	var result any
	switch method {
	case "eth_chainId":
		result = f.chain
	case "eth_getBlockByNumber":
		if params[0] == "0x1" {
			result = Block{Hash: f.anchor, Number: "0x1"}
		} else {
			result = Block{Hash: testBlock, Number: "0x2"}
		}
	case "eth_getBlockByHash":
		to := "0x0000000000000000000000000000000000000001"
		result = Block{Hash: testBlock, Number: "0x2", Transactions: []Transaction{{Hash: testTx, From: to, To: &to, Index: "0x0", BlockHash: testBlock}}}
	case "eth_getBlockAccessList":
		result = []any{}
	case "eth_getTransactionReceipt":
		hash := testBlock
		if f.badReceipt {
			hash = testAnchor
		}
		result = Receipt{Hash: testTx, BlockHash: hash, BlockNumber: "0x2", Index: "0x0", Status: "0x1", Logs: nil}
	case "eth_getTransactionByHash":
		hash := testBlock
		if f.badBinding {
			hash = testAnchor
		}
		result = Transaction{Hash: testTx, BlockHash: hash, Index: "0x0"}
	default:
		return domain.RawRecord{}, errors.New("unsupported tracing method")
	}
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "result": result})
	return domain.RawRecord{Source: domain.Source{Kind: method, Origin: "https://synthetic.invalid", FetchedAt: time.Now().UTC()}, Body: body}, nil
}
func testCollector() *Collector {
	return &Collector{AnchorNumber: "0x1", AnchorHash: testAnchor, Execution: rpcFake{chain: "0x1", anchor: testAnchor}, Trace: rpcFake{chain: "0x1", anchor: testAnchor}, Network: "test", Mode: "synthetic", ChainID: "1", Native: true}
}
func TestCollectorRejectsNetworkAndReceiptMismatch(t *testing.T) {
	for _, name := range []string{"execution_chain", "execution_anchor", "trace_anchor", "receipt"} {
		t.Run(name, func(t *testing.T) {
			c := testCollector()
			switch name {
			case "execution_chain":
				c.Execution = rpcFake{chain: "0x2", anchor: testAnchor}
			case "execution_anchor":
				c.Execution = rpcFake{chain: "0x1", anchor: testBlock}
			case "trace_anchor":
				c.Trace = rpcFake{chain: "0x1", anchor: testBlock}
			case "receipt":
				c.Execution = rpcFake{chain: "0x1", anchor: testAnchor, badReceipt: true}
			}
			if _, err := c.Fetch(context.Background(), testBlock, []string{testTx}); err == nil {
				t.Fatal("accepted mismatched evidence")
			}
		})
	}
}
func TestCollectorUnavailableReadsRemainUnknown(t *testing.T) {
	c := testCollector()
	s, err := c.Fetch(context.Background(), testBlock, []string{testTx})
	if err != nil {
		t.Fatal(err)
	}
	if s.Run.Graph.Complete || s.Run.Graph.StorageComplete || s.Run.Graph.TheoreticalSpeedup != nil || s.Run.Transactions[0].OpcodeTraceAvailable {
		t.Fatal("claimed complete reads")
	}
	if s.Run.Native.CommitmentVerified != nil {
		t.Fatal("invented header commitment")
	}
	c.Trace = rpcFake{chain: "0x1", anchor: testAnchor, badBinding: true}
	s, err = c.Fetch(context.Background(), testBlock, []string{testTx})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(s.Run.Transactions[0].Coverage, ","), "binding_unavailable") || len(s.Run.Access[0].Reads) != 3 {
		t.Fatal(s.Run.Transactions)
	}
}
