package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"rooted/internal/bal"
	"rooted/internal/domain"
	"testing"
)

type balRPC struct {
	rpcFake
	unavailable bool
	raw         json.RawMessage
}

func (f balRPC) RPC(ctx context.Context, method string, params []any) (domain.RawRecord, error) {
	if method != "eth_getBlockAccessList" {
		return f.rpcFake.RPC(ctx, method, params)
	}
	if f.unavailable {
		return domain.RawRecord{}, errors.New("RPC method unavailable (code -32601)")
	}
	return domain.RawRecord{Body: append(append([]byte(`{"result":`), f.raw...), '}')}, nil
}

type envelopeFake struct {
	calls                       int
	hash, number, slot, encoded string
	err                         error
}

func (f *envelopeFake) Get(_ context.Context, path, kind string) (domain.RawRecord, error) {
	f.calls++
	if path != "/eth/v1/beacon/execution_payload_envelopes/12" {
		return domain.RawRecord{}, errors.New("wrong slot path")
	}
	body, _ := json.Marshal(map[string]any{"data": map[string]any{"message": map[string]any{"payload": map[string]string{"block_hash": f.hash, "block_number": f.number, "slot_number": f.slot, "block_access_list": f.encoded}}}})
	return domain.RawRecord{Source: domain.Source{Kind: kind}, Body: body}, f.err
}
func TestNativeBALTransportCompatibility(t *testing.T) {
	for _, name := range []string{"rpc", "fallback", "null", "no_beacon", "no_slot", "no_commitment", "hash", "number", "slot", "commitment", "unavailable_envelope", "malformed_rpc"} {
		t.Run(name, func(t *testing.T) {
			b := &Block{Hash: testBlock, Number: "0x2", SlotNumber: "0xc", BALHash: bal.Keccak([]byte{0xc0})}
			beacon := &envelopeFake{hash: testBlock, number: "2", slot: "12", encoded: "0xc0"}
			rpc := balRPC{unavailable: true}
			c := &Collector{Beacon: beacon}
			switch name {
			case "rpc":
				rpc.unavailable = false
				rpc.raw = json.RawMessage(`[]`)
			case "null":
				rpc.unavailable = false
				rpc.raw = json.RawMessage(`null`)
			case "no_beacon":
				c.Beacon = nil
			case "no_slot":
				b.SlotNumber = ""
			case "no_commitment":
				b.BALHash = ""
			case "hash":
				beacon.hash = testAnchor
			case "number":
				beacon.number = "3"
			case "slot":
				beacon.slot = "13"
			case "commitment":
				b.BALHash = testAnchor
			case "unavailable_envelope":
				beacon.err = errors.New("not found")
			case "malformed_rpc":
				rpc.unavailable = false
				rpc.raw = json.RawMessage(`{}`)
			}
			c.Execution = rpc
			f := &fetch{}
			got, e := c.nativeBAL(context.Background(), f, b)
			success := name == "rpc" || name == "fallback" || name == "null"
			if success {
				if e != nil {
					t.Fatal(e)
				}
				if got.CommitmentVerified == nil || !*got.CommitmentVerified {
					t.Fatal("missing verified commitment")
				}
			} else if e == nil {
				t.Fatal("accepted invalid evidence")
			}
			if (name == "rpc" || name == "malformed_rpc") && beacon.calls != 0 {
				t.Fatal("fallback masked existing RPC result")
			}
			if name == "fallback" && (len(f.records) != 1 || f.records[0].Kind != "analysis_native_bal_envelope") {
				t.Fatal("missing Beacon provenance")
			}
		})
	}
}
