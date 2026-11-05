package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"rooted/internal/domain"
	"testing"
)

type resolverRPC struct {
	tx  *Transaction
	err error
}

func (f resolverRPC) RPC(_ context.Context, method string, params []any) (domain.RawRecord, error) {
	if method != "eth_getTransactionByHash" || params[0] != testTx {
		return domain.RawRecord{}, errors.New("unexpected lookup")
	}
	body, _ := json.Marshal(map[string]any{"result": f.tx})
	return domain.RawRecord{Body: body}, f.err
}
func TestResolveTransactionBlock(t *testing.T) {
	for _, name := range []string{"mined", "missing", "pending", "mismatch", "bad_block", "source_failure", "bad_input"} {
		t.Run(name, func(t *testing.T) {
			tx := &Transaction{Hash: testTx, BlockHash: testBlock}
			rpc := resolverRPC{tx: tx}
			hash := testTx
			switch name {
			case "missing":
				rpc.tx = nil
			case "pending":
				tx.BlockHash = ""
			case "mismatch":
				tx.Hash = testAnchor
			case "bad_block":
				tx.BlockHash = "bad"
			case "source_failure":
				rpc.err = errors.New("offline")
			case "bad_input":
				hash = "bad"
			}
			c := Collector{Execution: rpc}
			block, e := c.ResolveTransactionBlock(context.Background(), hash)
			if name == "mined" {
				if e != nil || block != testBlock {
					t.Fatal(block, e)
				}
			} else if e == nil {
				t.Fatal("accepted unresolved transaction")
			}
			if name == "missing" && !errors.Is(e, ErrTransactionNotFound) {
				t.Fatal(e)
			}
			if name == "pending" && !errors.Is(e, ErrTransactionPending) {
				t.Fatal(e)
			}
		})
	}
}
