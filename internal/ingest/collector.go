package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"rooted/internal/domain"
	"rooted/internal/remote"
)

var (
	ErrUnavailable = errors.New("slot unavailable: skipped, pruned, or not exposed by provider")
	ErrMismatch    = errors.New("upstream identifiers or network do not match")
	ErrUnsupported = errors.New("block has no supported ePBS commitment")
)

var hashPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)

func ValidRoot(s string) bool { return hashPattern.MatchString(s) }

type Collector struct {
	Beacon                        remote.Beacon
	Execution                     remote.Execution
	Network, ChainID, GenesisRoot string
}

type headerResponse struct {
	Data struct {
		Root      string `json:"root"`
		Canonical *bool  `json:"canonical"`
		Header    struct {
			Message struct {
				Slot string `json:"slot"`
			} `json:"message"`
		} `json:"header"`
	} `json:"data"`
}
type bid struct {
	BlockHash    string `json:"block_hash"`
	BuilderIndex string `json:"builder_index"`
	Slot         string `json:"slot"`
}
type blockResponse struct {
	Finalized           *bool `json:"finalized"`
	ExecutionOptimistic *bool `json:"execution_optimistic"`
	Data                struct {
		Message struct {
			Slot          string `json:"slot"`
			ProposerIndex string `json:"proposer_index"`
			ParentRoot    string `json:"parent_root"`
			Body          struct {
				SignedBid struct {
					Message bid `json:"message"`
				} `json:"signed_execution_payload_bid"`
				PTC json.RawMessage `json:"payload_attestations"`
			} `json:"body"`
		} `json:"message"`
	} `json:"data"`
}
type envelopeResponse struct {
	Data struct {
		Message struct {
			BuilderIndex string `json:"builder_index"`
			BlockRoot    string `json:"beacon_block_root"`
			ParentRoot   string `json:"parent_beacon_block_root"`
			Payload      struct {
				Hash      string `json:"block_hash"`
				Number    string `json:"block_number"`
				Slot      string `json:"slot_number"`
				StateRoot string `json:"state_root"`
			} `json:"payload"`
		} `json:"message"`
	} `json:"data"`
}
type executionBlock struct {
	Hash      string `json:"hash"`
	Number    string `json:"number"`
	Slot      string `json:"slotNumber"`
	StateRoot string `json:"stateRoot"`
}

func parseNumber(s string) (uint64, error) {
	base := 10
	if strings.HasPrefix(s, "0x") {
		s = strings.TrimPrefix(s, "0x")
		base = 16
	}
	return strconv.ParseUint(s, base, 64)
}
func sameNumber(s string, expected uint64) bool {
	n, e := parseNumber(s)
	return e == nil && n == expected
}
func decodeResult(body json.RawMessage, target any) error {
	var r struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return err
	}
	if len(r.Result) == 0 {
		return errors.New("missing RPC result")
	}
	return json.Unmarshal(r.Result, target)
}

func (c *Collector) Fetch(ctx context.Context, slot uint64) (domain.Snapshot, error) {
	var snapshot domain.Snapshot
	add := func(r domain.RawRecord) { snapshot.Records = append(snapshot.Records, r) }
	genesisRoot, records, err := c.networkIdentity(ctx)
	snapshot.Records = append(snapshot.Records, records...)
	if err != nil {
		return snapshot, err
	}
	header, err := c.Beacon.Get(ctx, "/eth/v1/beacon/headers/"+strconv.FormatUint(slot, 10), "beacon_header")
	if errors.Is(err, remote.ErrNotFound) {
		return snapshot, ErrUnavailable
	}
	if err != nil {
		return snapshot, err
	}
	add(header)
	var h headerResponse
	if json.Unmarshal(header.Body, &h) != nil || !ValidRoot(h.Data.Root) || h.Data.Canonical == nil || !sameNumber(h.Data.Header.Message.Slot, slot) {
		return snapshot, fmt.Errorf("%w: header", ErrMismatch)
	}
	root := strings.ToLower(h.Data.Root)
	block, err := c.Beacon.Get(ctx, "/eth/v2/beacon/blocks/"+root, "beacon_block")
	if err != nil {
		return snapshot, err
	}
	add(block)
	var b blockResponse
	if json.Unmarshal(block.Body, &b) != nil {
		return snapshot, errors.New("malformed beacon block")
	}
	m := b.Data.Message
	commitment := m.Body.SignedBid.Message
	if commitment.BlockHash == "" {
		return snapshot, ErrUnsupported
	}
	if !sameNumber(m.Slot, slot) || !sameNumber(commitment.Slot, slot) || !ValidRoot(commitment.BlockHash) {
		return snapshot, fmt.Errorf("%w: commitment slot/hash", ErrMismatch)
	}
	if _, err := strconv.ParseUint(commitment.BuilderIndex, 10, 64); err != nil {
		return snapshot, errors.New("invalid builder index")
	}
	if _, err := strconv.ParseUint(m.ProposerIndex, 10, 64); err != nil {
		return snapshot, errors.New("invalid proposer index")
	}
	ptc := m.Body.PTC
	if len(ptc) == 0 || string(ptc) == "null" {
		ptc = json.RawMessage(`[]`)
	}
	o := domain.Observation{Network: c.Network, ChainID: c.ChainID, GenesisValidatorsRoot: genesisRoot, Slot: slot, BlockRoot: root,
		PayloadHash: strings.ToLower(commitment.BlockHash), BuilderIndex: commitment.BuilderIndex, SelfBuild: commitment.BuilderIndex == "18446744073709551615",
		ProposerIndex: m.ProposerIndex, CanonicalAtFetch: *h.Data.Canonical, FinalizedAtFetch: b.Finalized, ExecutionOptimistic: b.ExecutionOptimistic,
		Status: "pending", IncludedPTCAttestations: ptc, Limitations: []string{
			"Historical fetch: original arrival timestamps and reveal latency are unknown.",
			"PTC aggregates refer to their own slot/root; no target-slot timeliness or blob verdict is inferred.",
			"Execution block retrieval is not an independent execution validation or finality guarantee.",
			"Canonical and validation flags are source snapshots; this phase does not track later reorgs.",
		}}
	envelope, err := c.Beacon.Get(ctx, "/eth/v1/beacon/execution_payload_envelopes/"+root, "payload_envelope")
	var payload envelopeResponse
	if err == nil {
		add(envelope)
		if json.Unmarshal(envelope.Body, &payload) != nil {
			return snapshot, errors.New("malformed payload envelope")
		}
		p := payload.Data.Message
		if !strings.EqualFold(p.BlockRoot, root) || !strings.EqualFold(p.Payload.Hash, o.PayloadHash) || p.BuilderIndex != o.BuilderIndex || !strings.EqualFold(p.ParentRoot, m.ParentRoot) || !sameNumber(p.Payload.Slot, slot) {
			return snapshot, fmt.Errorf("%w: payload envelope", ErrMismatch)
		}
		o.PayloadRetrieved = true
	} else if errors.Is(err, remote.ErrNotFound) {
		o.Limitations = append(o.Limitations, "Payload envelope unavailable at fetch time; absence does not establish builder failure.")
	} else {
		return snapshot, fmt.Errorf("payload envelope: %w", err)
	}
	execution, err := c.Execution.RPC(ctx, "eth_getBlockByHash", []any{o.PayloadHash, false})
	if err != nil {
		return snapshot, err
	}
	add(execution)
	var eb *executionBlock
	if decodeResult(execution.Body, &eb) != nil {
		return snapshot, errors.New("malformed execution block")
	}
	if eb != nil {
		if !strings.EqualFold(eb.Hash, o.PayloadHash) || !sameNumber(eb.Slot, slot) {
			return snapshot, fmt.Errorf("%w: execution block", ErrMismatch)
		}
		n, err := parseNumber(eb.Number)
		if err != nil {
			return snapshot, errors.New("invalid execution block number")
		}
		number := strconv.FormatUint(n, 10)
		o.ExecutionBlockNumber = &number
		o.ExecutionBlockRetrieved = true
		if o.PayloadRetrieved {
			p := payload.Data.Message.Payload
			if !sameNumber(p.Number, n) || !ValidRoot(p.StateRoot) || !strings.EqualFold(p.StateRoot, eb.StateRoot) {
				return snapshot, fmt.Errorf("%w: execution state/number", ErrMismatch)
			}
			o.IdentifiersMatched = true
			o.Status = "observed"
		}
	} else {
		o.Limitations = append(o.Limitations, "Execution provider has no matching block at fetch time.")
	}
	o.FetchedAt = time.Now().UTC()
	for _, r := range snapshot.Records {
		o.Sources = append(o.Sources, r.Source)
	}
	snapshot.Observation = o
	return snapshot, nil
}
