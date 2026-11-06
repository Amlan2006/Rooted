package profiler

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"rooted/internal/domain"
)

type fakeExecution func(method string, params []any) (any, error)

func (f fakeExecution) RPC(_ context.Context, method string, params []any) (domain.RawRecord, error) {
	v, err := f(method, params)
	if err != nil {
		return domain.RawRecord{}, err
	}
	body, _ := json.Marshal(map[string]any{"result": v})
	return domain.RawRecord{Body: body}, nil
}

// Accounts created mid-block must appear empty in earlier traces, or the replay seeds them as pre-existing.
func TestCaptureAsksPrestateTracerForEmptyAccounts(t *testing.T) {
	hash := "0x" + strings.Repeat("ab", 32)
	var config map[string]any
	c := Collector{Binary: "unused", AnchorNumber: "0x1", AnchorHash: hash, RPC: fakeExecution(func(method string, params []any) (any, error) {
		switch method {
		case "eth_chainId":
			return "0xaa36a7", nil
		case "eth_getBlockByNumber":
			return map[string]any{"hash": hash, "number": "0x1"}, nil
		case "web3_clientVersion":
			return "Geth/v1.17.10-stable", nil
		case "eth_getBlockByHash":
			return map[string]any{"hash": hash, "number": "0x2", "transactions": []any{map[string]any{}}}, nil
		case "eth_getBlockReceipts":
			return []any{}, nil
		case "debug_traceBlockByHash":
			config, _ = params[1].(map[string]any)
		}
		return nil, errors.New("stop")
	})}
	if _, _, err := c.Capture(context.Background(), hash); err == nil {
		t.Fatal("fake capture unexpectedly completed")
	}
	tc, _ := config["tracerConfig"].(map[string]any)
	if config["tracer"] != "prestateTracer" || tc["includeEmpty"] != true {
		t.Fatalf("prestate trace config %v", config)
	}
}
