package payloadwatch

import (
	"encoding/json"
	"time"

	"rooted/internal/domain"
)

// Event is durable evidence. Modes and source identities are never combined.
type Event struct {
	ID          string    `json:"id"`
	Network     string    `json:"network"`
	Mode        string    `json:"mode"`
	SourceID    string    `json:"source_id"`
	Session     string    `json:"session,omitempty"`
	Kind        string    `json:"kind"`
	Slot        uint64    `json:"slot,string"`
	Root        string    `json:"block_root"`
	PayloadHash string    `json:"payload_hash,omitempty"`
	Builder     string    `json:"builder_index,omitempty"`
	ObservedAt  time.Time `json:"observed_at"`
	// Timed means a receipt on the monitored live stream, or explicitly timed replay evidence.
	Timed     bool                `json:"timed"`
	Valid     *bool               `json:"valid,omitempty"`
	Canonical *bool               `json:"canonical,omitempty"`
	Snapshot  *domain.Observation `json:"snapshot,omitempty"`
	Votes     *Votes              `json:"votes,omitempty"`
	Raw       json.RawMessage     `json:"raw,omitempty"`
}
type Votes struct {
	Bits           string `json:"bits,omitempty"`
	ValidatorIndex string `json:"validator_index,omitempty"`
	PayloadPresent bool   `json:"payload_present"`
	BlobAvailable  bool   `json:"blob_available"`
}
type Session struct {
	ID      string    `json:"id"`
	Start   time.Time `json:"start"`
	Through time.Time `json:"through"`
	Closed  bool      `json:"closed"`
}
type Policy struct {
	LateAfter    time.Duration
	MissingAfter time.Duration
	// Zero disables PTC verdicts. Operator must verify quorum and committee size for the network.
	PTCQuorum int
	PTCSize   int
}
type State struct {
	Policy                     FixturePolicy `json:"analysis_policy"`
	Network                    string        `json:"network"`
	Mode                       string        `json:"mode"`
	SourceID                   string        `json:"source_id"`
	Slot                       uint64        `json:"slot,string"`
	Root                       string        `json:"block_root"`
	PayloadHash                string        `json:"payload_hash"`
	Builder                    string        `json:"builder_index"`
	SelfBuild                  bool          `json:"self_build"`
	Canonical                  *bool         `json:"canonical"`
	Status                     string        `json:"status"`
	Delivery                   string        `json:"delivery"`
	CommitmentSeenAt           *time.Time    `json:"commitment_seen_at"`
	PayloadSeenAt              *time.Time    `json:"payload_seen_at"`
	RevealLatencyMS            *int64        `json:"reveal_latency_ms"`
	TimingSession              string        `json:"timing_session,omitempty"`
	PayloadRetrieved           bool          `json:"payload_retrieved"`
	IdentifiersMatched         bool          `json:"identifiers_matched"`
	PTCTimely                  *bool         `json:"ptc_timely"`
	BlobAvailable              *bool         `json:"blob_available"`
	ExecutionValid             *bool         `json:"execution_valid"`
	ExecutionBasis             string        `json:"execution_basis,omitempty"`
	PTCPayloadYes              int           `json:"ptc_payload_yes"`
	PTCPayloadNo               int           `json:"ptc_payload_no"`
	PTCBlobYes                 int           `json:"ptc_blob_yes"`
	PTCBlobNo                  int           `json:"ptc_blob_no"`
	PTCConflictingParticipants int           `json:"ptc_conflicting_participants"`
	UpdatedAt                  time.Time     `json:"updated_at"`
	FirstObservedAt            time.Time     `json:"first_observed_at"`
	Alerts                     []string      `json:"alerts"`
	Coverage                   []string      `json:"coverage"`
	EventCount                 int           `json:"event_count"`
}
type BuilderStats struct {
	Builder      string   `json:"builder_index"`
	SelfBuild    bool     `json:"self_build"`
	Observations int64    `json:"observations"`
	Revealed     int64    `json:"revealed"`
	Late         int64    `json:"late"`
	Missing      int64    `json:"missing"`
	Failed       int64    `json:"failed"`
	Healthy      int64    `json:"healthy"`
	Unknown      int64    `json:"unknown"`
	Timed        int64    `json:"timed_samples"`
	HealthyRatio *float64 `json:"healthy_ratio"`
	RevealRatio  *float64 `json:"reveal_ratio"`
	P50          *float64 `json:"p50_reveal_ms"`
	P95          *float64 `json:"p95_reveal_ms"`
	P99          *float64 `json:"p99_reveal_ms"`
}
