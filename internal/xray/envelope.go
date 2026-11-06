package xray

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"rooted/internal/bal"
	"rooted/internal/ingest"
	"rooted/internal/remote"
)

// FetchEnvelope reads the ePBS payload envelope and decodes its commitment-checked BAL.
// shortcut: duplicates ~30 lines of internal/analysis.nativeBAL (unexported); merge if a third caller appears.
func FetchEnvelope(ctx context.Context, b remote.Beacon, slot uint64, blockHash string, number uint64, n int, commitment string) (bal.Native, Envelope, error) {
	record, err := b.Get(ctx, fmt.Sprintf("/eth/v1/beacon/execution_payload_envelopes/%d", slot), "xray_payload_envelope")
	if err != nil {
		return bal.Native{}, Envelope{}, fmt.Errorf("payload envelope unavailable: %w", err)
	}
	return parseEnvelope(record.Body, slot, blockHash, number, n, commitment)
}

func parseEnvelope(body []byte, slot uint64, blockHash string, number uint64, n int, commitment string) (bal.Native, Envelope, error) {
	var envelope struct {
		Data struct {
			Message struct {
				Payload struct {
					Hash   string `json:"block_hash"`
					Number string `json:"block_number"`
					Slot   string `json:"slot_number"`
					BAL    string `json:"block_access_list"`
				} `json:"payload"`
				Builder string `json:"builder_index"`
				Root    string `json:"beacon_block_root"`
			} `json:"message"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return bal.Native{}, Envelope{}, errors.New("invalid payload envelope JSON")
	}
	m := envelope.Data.Message
	if _, err := strconv.ParseUint(m.Builder, 10, 64); err != nil || !ingest.ValidRoot(m.Root) || !strings.EqualFold(m.Payload.Hash, blockHash) || m.Payload.Number != fmt.Sprint(number) || m.Payload.Slot != fmt.Sprint(slot) {
		return bal.Native{}, Envelope{}, errors.New("payload envelope block/slot identity mismatch")
	}
	if commitment == "" {
		return bal.Native{}, Envelope{}, errors.New("block header has no BAL commitment")
	}
	native, err := bal.DecodeNativeRLP(m.Payload.BAL, n, commitment)
	if err != nil {
		return bal.Native{}, Envelope{}, err
	}
	return native, Envelope{Slot: slot, BeaconBlockRoot: strings.ToLower(m.Root), BuilderIndex: m.Builder}, nil
}
