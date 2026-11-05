// Package bal is application-independent block access and dependency analysis.
package bal

import "encoding/json"

type Location struct {
	Address string `json:"address"`
	Field   string `json:"field"`
	Key     string `json:"key,omitempty"`
}

func (l Location) ID() string { return l.Address + ":" + l.Field + ":" + l.Key }

type Change struct {
	Location
	Index            uint64  `json:"block_access_index"`
	TransactionIndex *uint64 `json:"transaction_index"`
	Phase            string  `json:"phase"`
	Value            string  `json:"post_value"`
	Source           string  `json:"source"`
}
type Access struct {
	Index                uint64     `json:"index"`
	Hash                 string     `json:"hash"`
	Reads                []Location `json:"reads"`
	Writes               []Location `json:"writes"`
	Candidates           []Location `json:"access_candidates"`
	Coverage             []string   `json:"coverage"`
	StorageReadsComplete bool       `json:"storage_reads_complete"`
}
type Native struct {
	Accounts           int        `json:"accounts"`
	ReadOnly           []Location `json:"block_read_only_storage"`
	Changes            []Change   `json:"changes"`
	ComputedHash       string     `json:"computed_commitment"`
	CommitmentVerified *bool      `json:"commitment_verified"`
	Schema             string     `json:"schema"`
}
type Edge struct {
	From     uint64   `json:"from"`
	To       uint64   `json:"to"`
	Kind     string   `json:"kind"`
	Location Location `json:"location"`
	Basis    string   `json:"basis"`
}
type Hotspot struct {
	Location
	Readers int `json:"known_readers"`
	Writers int `json:"writers"`
}
type Graph struct {
	ConflictCounts     map[string]int `json:"observed_conflict_counts"`
	Edges              []Edge         `json:"edges"`
	Hotspots           []Hotspot      `json:"hotspots"`
	Layers             [][]uint64     `json:"observed_layers"`
	Depth              int            `json:"observed_dependency_depth"`
	Width              int            `json:"observed_max_layer_width"`
	Transactions       int            `json:"transactions"`
	Truncated          bool           `json:"truncated"`
	Complete           bool           `json:"full_dependency_coverage"`
	StorageComplete    bool           `json:"storage_read_coverage_complete"`
	TheoreticalSpeedup *float64       `json:"theoretical_speedup"`
	Coverage           []string       `json:"coverage"`
}
type RPCChange struct {
	Index string `json:"index"`
	Value string `json:"value"`
}
type CodeChange struct {
	Index string `json:"index"`
	Code  string `json:"code"`
}
type Slot struct {
	Key     string      `json:"key"`
	Changes []RPCChange `json:"changes"`
}
type Account struct {
	Address string       `json:"address"`
	Storage []Slot       `json:"storageChanges"`
	Reads   []string     `json:"storageReads"`
	Balance []RPCChange  `json:"balanceChanges"`
	Nonce   []RPCChange  `json:"nonceChanges"`
	Code    []CodeChange `json:"codeChanges"`
}
type Opcode struct {
	Op    string          `json:"op"`
	Depth int             `json:"depth"`
	Stack []string        `json:"stack"`
	Error json.RawMessage `json:"error"`
}
type OpcodeTrace struct {
	Failed bool     `json:"failed"`
	Logs   []Opcode `json:"structLogs"`
}
