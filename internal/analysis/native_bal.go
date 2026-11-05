package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"rooted/internal/bal"
	"strings"
)

func (c *Collector) nativeBAL(ctx context.Context, f *fetch, block *Block) (bal.Native, error) {
	var raw json.RawMessage
	err := f.rpc(ctx, c.Execution, "eth_getBlockAccessList", block.Hash, []any{block.Hash}, &raw)
	if err == nil && string(raw) != "null" {
		// A malformed response or commitment mismatch must not be hidden by fallback.
		return bal.DecodeNative(raw, len(block.Transactions), block.BALHash)
	}
	if err == nil {
		err = errors.New("execution RPC returned a null BAL")
	}
	if ctx.Err() != nil {
		return bal.Native{}, ctx.Err()
	}
	if c.Beacon == nil {
		return bal.Native{}, fmt.Errorf("native BAL unavailable: %v", err)
	}
	slot, e := bal.Number(block.SlotNumber)
	if e != nil {
		return bal.Native{}, errors.New("native BAL fallback requires execution block slotNumber")
	}
	if block.BALHash == "" {
		return bal.Native{}, errors.New("native BAL fallback requires header commitment")
	}
	path := fmt.Sprintf("/eth/v1/beacon/execution_payload_envelopes/%d", slot)
	record, e := c.Beacon.Get(ctx, path, "analysis_native_bal_envelope")
	if len(record.Body) > 0 {
		f.records = append(f.records, record)
	}
	if e != nil {
		return bal.Native{}, fmt.Errorf("native BAL unavailable from execution RPC (%v) and Beacon envelope: %w", err, e)
	}
	var envelope struct {
		Data struct {
			Message struct {
				Payload struct {
					Hash   string `json:"block_hash"`
					Number string `json:"block_number"`
					Slot   string `json:"slot_number"`
					BAL    string `json:"block_access_list"`
				} `json:"payload"`
			} `json:"message"`
		} `json:"data"`
	}
	if e = json.Unmarshal(record.Body, &envelope); e != nil {
		return bal.Native{}, errors.New("invalid native BAL envelope JSON")
	}
	payload := envelope.Data.Message.Payload
	number, e := bal.Number(block.Number)
	if e != nil || !strings.EqualFold(payload.Hash, block.Hash) || payload.Number != fmt.Sprint(number) || payload.Slot != fmt.Sprint(slot) {
		return bal.Native{}, errors.New("native BAL envelope block/slot identity mismatch")
	}
	return bal.DecodeNativeRLP(payload.BAL, len(block.Transactions), block.BALHash)
}
