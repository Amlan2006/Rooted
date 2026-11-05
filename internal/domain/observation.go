package domain

import (
	"encoding/json"
	"time"
)

// Observation is a historical fetch snapshot, not a live arrival-time measurement.
type Observation struct {
	Network                 string          `json:"network"`
	ChainID                 string          `json:"chain_id"`
	GenesisValidatorsRoot   string          `json:"genesis_validators_root"`
	Slot                    uint64          `json:"slot,string"`
	BlockRoot               string          `json:"block_root"`
	PayloadHash             string          `json:"payload_hash"`
	BuilderIndex            string          `json:"builder_index"`
	SelfBuild               bool            `json:"self_build"`
	ProposerIndex           string          `json:"proposer_index"`
	ExecutionBlockNumber    *string         `json:"execution_block_number"`
	CanonicalAtFetch        bool            `json:"canonical_at_fetch"`
	FinalizedAtFetch        *bool           `json:"finalized_at_fetch"`
	ExecutionOptimistic     *bool           `json:"execution_optimistic"`
	PayloadRetrieved        bool            `json:"payload_retrieved"`
	ExecutionBlockRetrieved bool            `json:"execution_block_retrieved"`
	IdentifiersMatched      bool            `json:"identifiers_matched"`
	Status                  string          `json:"status"`
	FetchedAt               time.Time       `json:"fetched_at"`
	CommitmentSeenAt        *time.Time      `json:"commitment_seen_at"`
	PayloadSeenAt           *time.Time      `json:"payload_seen_at"`
	RevealLatencyMS         *int64          `json:"reveal_latency_ms"`
	PTCTimely               *bool           `json:"ptc_timely"`
	BlobAvailable           *bool           `json:"blob_available"`
	ExecutionValid          *bool           `json:"execution_valid"`
	IncludedPTCAttestations json.RawMessage `json:"included_ptc_attestations"`
	Limitations             []string        `json:"limitations"`
	Sources                 []Source        `json:"sources"`
}

type Source struct {
	Kind      string    `json:"kind"`
	Origin    string    `json:"origin"`
	FetchedAt time.Time `json:"fetched_at"`
}

type RawRecord struct {
	Source
	Body json.RawMessage
}

type Snapshot struct {
	Observation Observation
	Records     []RawRecord
}
