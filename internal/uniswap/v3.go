// Package uniswap translates generic execution evidence into Uniswap v3 concepts.
package uniswap

import (
	"encoding/hex"
	"errors"
	"math/big"
	"rooted/internal/bal"
	"strings"
)

const Factory = "0x0227628f3f023bb0b980b67d528571c95c6dac1c"
const SwapTopic = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
const SwapSelector = "0x128acb08"

type Log struct {
	Address   string   `json:"address"`
	Topics    []string `json:"topics"`
	Data      string   `json:"data"`
	Hash      string   `json:"transactionHash"`
	BlockHash string   `json:"blockHash"`
	Index     string   `json:"logIndex"`
	Removed   bool     `json:"removed"`
}
type Swap struct {
	Pool         string `json:"pool"`
	Transaction  string `json:"transaction_hash"`
	LogIndex     string `json:"log_index"`
	Sender       string `json:"sender"`
	Recipient    string `json:"recipient"`
	Amount0      string `json:"amount0_raw"`
	Amount1      string `json:"amount1_raw"`
	SqrtPrice    string `json:"sqrt_price_x96"`
	Liquidity    string `json:"liquidity"`
	Tick         int64  `json:"tick"`
	PoolVerified bool   `json:"pool_verified"`
}
type Call struct {
	Type    string `json:"type"`
	From    string `json:"from"`
	To      string `json:"to"`
	Input   string `json:"input"`
	Error   string `json:"error"`
	GasUsed string `json:"gasUsed"`
	Calls   []Call `json:"calls"`
}
type Attempt struct {
	AncestorFailed      bool   `json:"ancestor_failed"`
	Pool                string `json:"pool"`
	Transaction         string `json:"transaction_hash"`
	Selector            string `json:"selector"`
	CallFailed          bool   `json:"call_failed"`
	TransactionReverted bool   `json:"transaction_reverted"`
	Committed           bool   `json:"committed"`
	PoolVerified        bool   `json:"pool_verified"`
	Recipient           string `json:"recipient"`
	ZeroForOne          bool   `json:"zero_for_one"`
	AmountSpecified     string `json:"amount_specified_raw"`
	SqrtLimit           string `json:"sqrt_price_limit_x96"`
}
type Pool struct {
	Address  string   `json:"address"`
	Factory  string   `json:"factory"`
	Token0   string   `json:"token0"`
	Token1   string   `json:"token1"`
	Fee      uint64   `json:"fee"`
	Verified bool     `json:"verified"`
	Coverage []string `json:"coverage"`
}

func topicAddress(s string) (string, error) {
	if len(s) != 66 || !strings.HasPrefix(s, "0x") {
		return "", errors.New("invalid address topic")
	}
	if s[2:26] != strings.Repeat("0", 24) {
		return "", errors.New("noncanonical address padding")
	}
	return bal.Address("0x" + s[26:])
}
func signed(word []byte) *big.Int {
	v := new(big.Int).SetBytes(word)
	if word[0]&0x80 != 0 {
		v.Sub(v, new(big.Int).Lsh(big.NewInt(1), 256))
	}
	return v
}
func DecodeSwap(log Log) (Swap, error) {
	if len(log.Topics) != 3 || !strings.EqualFold(log.Topics[0], SwapTopic) || log.Removed {
		return Swap{}, errors.New("not a retained v3 Swap event")
	}
	pool, err := bal.Address(log.Address)
	if err != nil {
		return Swap{}, err
	}
	data, err := hex.DecodeString(strings.TrimPrefix(log.Data, "0x"))
	if err != nil || len(data) != 160 {
		return Swap{}, errors.New("invalid Swap data length")
	}
	sender, err := topicAddress(log.Topics[1])
	if err != nil {
		return Swap{}, err
	}
	recipient, err := topicAddress(log.Topics[2])
	if err != nil {
		return Swap{}, err
	}
	price := new(big.Int).SetBytes(data[64:96])
	liquidity := new(big.Int).SetBytes(data[96:128])
	tick := signed(data[128:160])
	if price.BitLen() > 160 || liquidity.BitLen() > 128 || !tick.IsInt64() || tick.Int64() < -(1<<23) || tick.Int64() >= 1<<23 {
		return Swap{}, errors.New("Swap ABI integer out of range")
	}
	return Swap{Pool: pool, Transaction: strings.ToLower(log.Hash), LogIndex: log.Index, Sender: sender, Recipient: recipient, Amount0: signed(data[:32]).String(), Amount1: signed(data[32:64]).String(), SqrtPrice: price.String(), Liquidity: liquidity.String(), Tick: tick.Int64()}, nil
}
func Attempts(root Call, tx string, reverted bool) []Attempt {
	out := []Attempt{}
	var visit func(Call, bool)
	visit = func(call Call, ancestorFailed bool) {
		failed := ancestorFailed || call.Error != ""
		if strings.HasPrefix(strings.ToLower(call.Input), SwapSelector) {
			data, err := hex.DecodeString(call.Input[10:])
			pool, e := bal.Address(call.To)
			if err == nil && e == nil && len(data) >= 160 {
				recipient, e := topicAddress("0x" + hex.EncodeToString(data[:32]))
				flag := new(big.Int).SetBytes(data[32:64])
				price := new(big.Int).SetBytes(data[96:128])
				if e == nil && flag.BitLen() <= 1 && price.BitLen() <= 160 {
					out = append(out, Attempt{Pool: pool, Transaction: tx, Selector: SwapSelector, CallFailed: call.Error != "", AncestorFailed: ancestorFailed, TransactionReverted: reverted, Committed: !failed && !reverted, Recipient: recipient, ZeroForOne: flag.Sign() > 0, AmountSpecified: signed(data[64:96]).String(), SqrtLimit: price.String()})
				}
			}
		}
		for _, child := range call.Calls {
			visit(child, failed)
		}
	}
	visit(root, false)
	return out
}
func StorageLabel(key string) string {
	b, err := bal.Number(key)
	if err != nil {
		return "unattributed_storage_key"
	}
	switch b {
	case 0:
		return "slot0_price_tick_and_lock"
	case 1:
		return "fee_growth_global_0"
	case 2:
		return "fee_growth_global_1"
	case 3:
		return "protocol_fees"
	case 4:
		return "active_liquidity"
	}
	return "mapping_or_observation_storage"
}
