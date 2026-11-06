// Package xray compares parallelism ceilings for one Sepolia block: gas-weighted (receipt gas and
// EIP-8037 execution gas), validator-with-BAL (Amdahl on measured time) and builder/no-BAL (conflict-DAG critical path).
package xray

import (
	"time"

	"rooted/internal/uniswap"
)

const Schema = "rooted-xray-v1"

// Replay.Timing: which replay samples t_i comes from.
const (
	TimingControl      = "uninstrumented_control"
	TimingInstrumented = "instrumented"
)

var Cores = []int{1, 2, 4, 8, 16}

type Report struct {
	Schema       string        `json:"schema"`
	Network      string        `json:"network"`
	ComputedAt   time.Time     `json:"computed_at"`
	Source       string        `json:"source"`
	ProfileID    *string       `json:"profile_id"`
	Block        Block         `json:"block"`
	Gas          Gas           `json:"gas"`
	BAL          BAL           `json:"bal"`
	Transactions []Tx          `json:"transactions"`
	Edges        Edges         `json:"edges"`
	Independent  int           `json:"independent_transactions"`
	Ceilings     CeilingSet    `json:"ceilings"`
	Schedules    Schedules     `json:"schedules"`
	HotLocations []Hot         `json:"hot_locations"`
	Uniswap      UniswapCounts `json:"uniswap"`
	EPBS         *EPBS         `json:"epbs"`
	Replay       *Replay       `json:"replay"`
	Excluded     []string      `json:"excluded_addresses"`
	Coverage     []string      `json:"coverage"`
}
type Block struct {
	Number                uint64  `json:"number"`
	Hash                  string  `json:"hash"`
	ParentHash            string  `json:"parent_hash"`
	Timestamp             uint64  `json:"timestamp"`
	Slot                  *uint64 `json:"slot"`
	BeaconBlockRoot       *string `json:"beacon_block_root"`
	ParentBeaconBlockRoot string  `json:"parent_beacon_block_root"`
	FeeRecipient          string  `json:"fee_recipient"`
	GasLimit              uint64  `json:"gas_limit"`
	TransactionCount      int     `json:"transaction_count"`
}
type Gas struct {
	HeaderGasUsed  uint64 `json:"header_gas_used"`
	ReceiptsGasSum uint64 `json:"receipts_gas_sum"`
	Differs        bool   `json:"differs"`
}
type BAL struct {
	Commitment         string `json:"commitment"`
	ComputedCommitment string `json:"computed_commitment"`
	CommitmentVerified bool   `json:"commitment_verified"`
	Accounts           int    `json:"accounts"`
	Source             string `json:"source"`
	Schema             string `json:"schema"`
}
type Tx struct {
	Index        int     `json:"index"`
	Hash         string  `json:"hash"`
	From         string  `json:"from"`
	To           *string `json:"to"`
	IsCreate     bool    `json:"is_create"`
	Status       uint64  `json:"status"`
	GasUsed      uint64  `json:"gas_used"`      // receipt gas: execution + EIP-8037 state gas, after refunds
	ExecutionGas *uint64 `json:"execution_gas"` // EIP-8037 execution dimension, before refunds
	StateGas     *uint64 `json:"state_gas"`
	ApplyNS      *int64  `json:"apply_ns_median"`
	Reads        int     `json:"reads"`
	Writes       int     `json:"writes"`
	DependsOn    []int   `json:"depends_on"`
}
type Edges struct {
	RAW            int  `json:"RAW"`
	WAR            int  `json:"WAR"`
	WAW            int  `json:"WAW"`
	Total          int  `json:"total"`
	DependentPairs int  `json:"dependent_pairs"`
	Truncated      bool `json:"truncated"`
}

// Ceiling is an upper bound on speedup; nil fields mean the weight was unavailable.
type Ceiling struct {
	Model        string   `json:"model"`
	Weight       string   `json:"weight"`
	Value        *float64 `json:"value"`
	Total        *int64   `json:"total"`
	Bottleneck   *int64   `json:"bottleneck"`
	CappingTx    *int     `json:"capping_tx_index"`
	CriticalPath []int    `json:"critical_path,omitempty"`
}
type CeilingSet struct {
	Gas       Ceiling `json:"gas_weighted"` // receipt gasUsed
	Execution Ceiling `json:"execution_gas_weighted"`
	Validator Ceiling `json:"validator_bal_time"`
	Builder   Ceiling `json:"builder_dag_time"` // static scheduler: orders every RAW, WAR and WAW conflict
	// No-BAL executor with multi-versioned state (Block-STM style): WAR edges dropped; nil Value on older reports.
	BuilderMultiVersion Ceiling `json:"builder_multiversion_time"`
}
type Schedules struct {
	Cores     []int     `json:"cores"`
	Validator []float64 `json:"validator_bal_time"`
	Builder   []float64 `json:"builder_dag_time"`
}
type Hot struct {
	Address        string         `json:"address"`
	Field          string         `json:"field"`
	Key            string         `json:"key"`
	Writers        int            `json:"writers"`
	Readers        int            `json:"readers"`
	Edges          int            `json:"edges"`
	OnCriticalPath bool           `json:"on_critical_path"`
	Label          *uniswap.Label `json:"label"`
}
type UniswapCounts struct {
	V3Swaps      int `json:"v3_swap_transactions"`
	V4Swaps      int `json:"v4_swap_transactions"`
	LabeledEdges int `json:"labeled_edges"`
}

// UniswapBlock is one stored report's Uniswap contention, read from its hot locations (no recompute).
type UniswapBlock struct {
	BlockNumber   uint64 `json:"block_number"`
	BlockHash     string `json:"block_hash"`
	UniswapEdges  int    `json:"uniswap_edges"`
	TotalEdges    int    `json:"total_edges"`
	UnlistedEdges int    `json:"unlisted_uniswap_edges"` // labelled edges on locations the report did not keep
	// The report stores the critical path's tx indices but not each tx's locations, so the Uniswap share of the
	// path is counted in labelled locations with an edge on it, not in transactions. Nil without a builder ceiling.
	CriticalPathLength           *int          `json:"critical_path_length"`
	CriticalPathUniswapLocations *int          `json:"critical_path_uniswap_locations"`
	Pools                        []UniswapPool `json:"pools"`
}
type UniswapPool struct {
	Protocol       string   `json:"protocol"`
	Pool           string   `json:"pool"`
	Verified       bool     `json:"verified"`
	Edges          int      `json:"edges"`
	OnCriticalPath bool     `json:"on_critical_path"`
	Labels         []string `json:"labels"`
}
type UniswapScan struct {
	Reports int            `json:"reports_scanned"`
	Matches int            `json:"blocks_with_uniswap_edges"`
	Blocks  []UniswapBlock `json:"blocks"`
}
type Envelope struct {
	Slot                          uint64
	BeaconBlockRoot, BuilderIndex string
}
type EPBS struct {
	Slot            uint64  `json:"slot"`
	BeaconBlockRoot string  `json:"beacon_block_root"`
	BuilderIndex    string  `json:"builder_index"`
	Source          string  `json:"source"`
	SelfBuild       *bool   `json:"self_build"`
	Status          *string `json:"status"`
	Delivery        *string `json:"delivery"`
	RevealLatencyMS *int64  `json:"reveal_latency_ms"`
	PTCPayloadYes   *int    `json:"ptc_payload_yes"`
	PTCPayloadNo    *int    `json:"ptc_payload_no"`
	PTCTimely       *bool   `json:"ptc_timely"`
	Canonical       *bool   `json:"canonical"`
}
type Replay struct {
	Runner      string `json:"runner"`
	GethLibrary string `json:"geth_library"`
	CPUModel    string `json:"cpu_model"`
	LogicalCPUs int    `json:"logical_cpus"`
	Samples     int    `json:"samples"`
	MedianNS    int64  `json:"median_apply_ns"`
	Timing      string `json:"timing"`
}
type Brief struct {
	BlockHash                 string    `json:"block_hash"`
	BlockNumber               uint64    `json:"block_number"`
	Slot                      *uint64   `json:"slot"`
	ComputedAt                time.Time `json:"computed_at"`
	Source                    string    `json:"source"`
	TransactionCount          int       `json:"transaction_count"`
	HeaderGasUsed             uint64    `json:"header_gas_used"`
	ReceiptsGasSum            uint64    `json:"receipts_gas_sum"`
	CommitmentVerified        bool      `json:"commitment_verified"`
	GasWeighted               *float64  `json:"gas_weighted"`
	ExecutionGasWeighted      *float64  `json:"execution_gas_weighted"`
	ValidatorBALTime          *float64  `json:"validator_bal_time"`
	BuilderDAGTime            *float64  `json:"builder_dag_time"`
	BuilderMultiVersionTime   *float64  `json:"builder_multiversion_time"`
	GasCappingTx              *int      `json:"gas_capping_tx_index"`
	ValidatorCappingTx        *int      `json:"validator_capping_tx_index"`
	BuilderCriticalPathLength *int      `json:"builder_critical_path_length"`
	Speedup8Validator         *float64  `json:"speedup_8_validator"`
	Speedup8Builder           *float64  `json:"speedup_8_builder"`
	BuilderIndex              *string   `json:"builder_index"`
	// Strict: the time-capping tx uses less gas than the gas-capping one, so equal-gas ties do not count.
	GasMisidentifies          *bool `json:"gas_misidentifies_bottleneck"`
	ExecutionGasMisidentifies *bool `json:"execution_gas_misidentifies_bottleneck"`
}
type Percentiles struct {
	P10    float64 `json:"p10"`
	Median float64 `json:"median"`
	P90    float64 `json:"p90"`
}
type Summary struct {
	Blocks    int     `json:"blocks"`
	FromBlock *uint64 `json:"from_block"`
	ToBlock   *uint64 `json:"to_block"`
	Ceilings  struct {
		Gas       *Percentiles `json:"gas_weighted"`
		Execution *Percentiles `json:"execution_gas_weighted"`
		Validator *Percentiles `json:"validator_bal_time"`
		Builder   *Percentiles `json:"builder_dag_time"`
		BuilderMV *Percentiles `json:"builder_multiversion_time"`
	} `json:"ceilings"`
	SingleTxBound      *float64 `json:"single_tx_bound_share"`
	GasMisidentifies   *float64 `json:"gas_misidentifies_bottleneck_share"`
	ExecMisidentifies  *float64 `json:"execution_gas_misidentifies_bottleneck_share"`
	CommitmentVerified *float64 `json:"commitment_verified_share"`
	Speedup8           struct {
		Validator *float64 `json:"validator_median"`
		Builder   *float64 `json:"builder_median"`
	} `json:"speedup_8"`
}
