package framemempool

import (
	"encoding/json"
	"time"
)

type Scope struct {
	Network string `json:"network"`
	Mode    string `json:"mode"`
	Node    string `json:"node"`
}
type Info struct {
	Origin   string `json:"source_origin,omitempty"`
	Protocol int    `json:"protocolVersion"`
	ChainID  uint64 `json:"chainId"`
	Version  string `json:"version"`
	Commit   string `json:"commit"`
	Boot     string `json:"bootId"`
	Latest   int64  `json:"latestSeq"`
	Oldest   int64  `json:"oldestSeq"`
	Capacity int    `json:"historyCapacity"`
	Bundling string `json:"bundlingMode"`
	P2P      bool   `json:"p2pEnabled"`
	Faucet   bool   `json:"faucetEnabled"`
}
type Check struct {
	Rule    string `json:"rule"`
	Verdict string `json:"verdict"`
	Detail  string `json:"detail,omitempty"`
	Frame   *int   `json:"frameIndex,omitempty"`
	Entity  string `json:"entity,omitempty"`
}
type Frame struct {
	Mode   int     `json:"mode"`
	Flags  int     `json:"flags"`
	Target *string `json:"target"`
	Limits struct {
		Execution string `json:"execution"`
		State     string `json:"state"`
	} `json:"limits"`
	Value string `json:"value"`
	Data  string `json:"data"`
}
type Admission struct {
	ObservedEventSeq int64    `json:"observed_event_seq,omitempty"`
	PoolStatus       string   `json:"observed_pool_status,omitempty"`
	ID               int64    `json:"id"`
	Hash             string   `json:"txHash"`
	Sender           string   `json:"sender"`
	Nonce            string   `json:"nonce"`
	NonceKeys        []string `json:"nonceKeys"`
	At               int64    `json:"at"`
	Source           string   `json:"source"`
	Outcome          string   `json:"outcome"`
	ErrorCode        *int     `json:"errorCode,omitempty"`
	Includer         string   `json:"includer,omitempty"`
	Checks           []Check  `json:"checks"`
	Frames           []Frame  `json:"frames"`
	FrameStatuses    []string `json:"frameStatuses"`
}
type Event struct {
	Seq    int64  `json:"seq"`
	Hash   string `json:"txHash"`
	At     int64  `json:"at"`
	Kind   string `json:"kind"`
	Status string `json:"status,omitempty"`
	Reason string `json:"reason,omitempty"`
}
type Detail struct {
	Hash      string          `json:"hash"`
	Entry     json.RawMessage `json:"entry"`
	Admission *Admission      `json:"admission"`
	Events    []Event         `json:"events"`
}
type Page struct {
	Items []Admission `json:"items"`
	Next  string      `json:"nextCursor"`
}
type Raw struct {
	Method string
	Entity string
	Body   json.RawMessage
	At     time.Time
}
type Receipt struct {
	Hash        string          `json:"transactionHash"`
	BlockHash   string          `json:"blockHash"`
	BlockNumber string          `json:"blockNumber"`
	Status      string          `json:"status"`
	Type        string          `json:"type"`
	GasUsed     string          `json:"gasUsed"`
	Frames      json.RawMessage `json:"frameReceipts"`
}
type Proof struct {
	Origin          string          `json:"execution_origin,omitempty"`
	CheckedAt       time.Time       `json:"checked_at"`
	Receipt         *Receipt        `json:"receipt"`
	FrameReceipt    json.RawMessage `json:"frame_receipt,omitempty"`
	Canonical       *bool           `json:"canonical"`
	IdentityMatched bool            `json:"identity_matched"`
	Coverage        []string        `json:"coverage"`
}
type State struct {
	FirstObservedAt time.Time `json:"first_observed_at"`
	Scope
	Boot                   string     `json:"boot_id"`
	Hash                   string     `json:"tx_hash"`
	Admission              *Admission `json:"admission"`
	Events                 []Event    `json:"events"`
	Proof                  *Proof     `json:"receipt_check"`
	Status                 string     `json:"status"`
	AdmissionConfirmed     bool       `json:"admission_confirmed"`
	InclusionConfirmed     bool       `json:"inclusion_confirmed"`
	ExecutionSuccess       *bool      `json:"execution_success"`
	AdmissionToInclusionMS *int64     `json:"admission_to_inclusion_ms"`
	Coverage               []string   `json:"coverage"`
	Incidents              []string   `json:"incidents"`
	UpdatedAt              time.Time  `json:"updated_at"`
}
type NodeState struct {
	Scope
	ChainID   string    `json:"chain_id"`
	Genesis   string    `json:"genesis_hash"`
	Info      Info      `json:"info"`
	UpdatedAt time.Time `json:"updated_at"`
	Poll      string    `json:"poll_status"`
	Stream    string    `json:"stream_status"`
	Cursor    *string   `json:"scan_cursor"`
	Seq       int64     `json:"stream_seq"`
}
type Incident struct {
	Scope
	Boot   string          `json:"boot_id"`
	Hash   string          `json:"tx_hash"`
	Code   string          `json:"code"`
	At     time.Time       `json:"observed_at"`
	Detail json.RawMessage `json:"detail"`
}
