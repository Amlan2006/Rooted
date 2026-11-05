package analysis

import (
	"encoding/json"
	"rooted/internal/bal"
	"rooted/internal/domain"
	"rooted/internal/uniswap"
	"time"
)

type Transaction struct {
	Hash      string  `json:"hash"`
	From      string  `json:"from"`
	To        *string `json:"to"`
	Index     string  `json:"transactionIndex"`
	BlockHash string  `json:"blockHash"`
	Input     string  `json:"input"`
	Nonce     string  `json:"nonce"`
	Type      string  `json:"type"`
}

func (t *Transaction) UnmarshalJSON(raw []byte) error {
	if len(raw) > 0 && raw[0] == '"' {
		return json.Unmarshal(raw, &t.Hash)
	}
	type alias Transaction
	return json.Unmarshal(raw, (*alias)(t))
}

type Block struct {
	SlotNumber   string        `json:"slotNumber,omitempty"`
	Hash         string        `json:"hash"`
	Number       string        `json:"number"`
	Parent       string        `json:"parentHash"`
	Miner        string        `json:"miner"`
	BALHash      string        `json:"blockAccessListHash"`
	Transactions []Transaction `json:"transactions"`
}
type Receipt struct {
	Hash        string        `json:"transactionHash"`
	BlockHash   string        `json:"blockHash"`
	BlockNumber string        `json:"blockNumber"`
	Index       string        `json:"transactionIndex"`
	Status      string        `json:"status"`
	Gas         string        `json:"gasUsed"`
	Contract    *string       `json:"contractAddress"`
	Logs        []uniswap.Log `json:"logs"`
}
type TxResult struct {
	Transaction          Transaction `json:"transaction"`
	Receipt              Receipt     `json:"receipt"`
	CallTraceAvailable   bool        `json:"call_trace_available"`
	StateDiffAvailable   bool        `json:"state_diff_available"`
	OpcodeTraceAvailable bool        `json:"opcode_trace_available"`
	Coverage             []string    `json:"coverage"`
}
type Anchor struct {
	Number string `json:"number"`
	Hash   string `json:"hash"`
}
type Run struct {
	ID            string            `json:"id"`
	Network       string            `json:"network"`
	Mode          string            `json:"mode"`
	ChainID       string            `json:"chain_id"`
	Anchor        Anchor            `json:"network_anchor"`
	Block         Block             `json:"block"`
	Canonical     *bool             `json:"canonical_at_fetch"`
	Native        *bal.Native       `json:"native_bal"`
	Access        []bal.Access      `json:"transaction_access"`
	Transactions  []TxResult        `json:"analyzed_transactions"`
	Graph         bal.Graph         `json:"graph"`
	StorageGraph  bal.Graph         `json:"storage_projection"`
	Pools         []uniswap.Pool    `json:"uniswap_pools"`
	Swaps         []uniswap.Swap    `json:"uniswap_swaps"`
	Attempts      []uniswap.Attempt `json:"uniswap_swap_calls"`
	StorageLabels map[string]string `json:"uniswap_storage_labels"`
	Coverage      []string          `json:"coverage"`
	Sources       []domain.Source   `json:"sources"`
	CreatedAt     time.Time         `json:"created_at"`
}
type Snapshot struct {
	Run     Run
	Records []domain.RawRecord
}
