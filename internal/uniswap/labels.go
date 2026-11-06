package uniswap

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"math/big"
	"rooted/internal/bal"
	"slices"
	"strings"
)

// BlockContext is the Uniswap evidence of one block, derived from its receipt logs.
type BlockContext struct {
	V3Pools     map[string]bool     // pool address -> verified by factory (false = Swap-log candidate)
	V4Pools     map[string]bool     // poolId seen in PoolManager Swap/ModifyLiquidity/Initialize logs
	V4Ticks     map[string][]int64  // poolId -> Swap.tick and ModifyLiquidity tickLower/tickUpper
	V4Positions map[string][]string // poolId -> keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt))
	// Derived storage keys, so labelling every edge stays a map lookup; nil => derived per call.
	manager, tokens map[string]Label
}

type Label struct {
	Protocol string `json:"protocol"`
	Name     string `json:"name"`
	Pool     string `json:"pool"` // v3 pool address, v4 poolId, or the holder/PoolManager address
	Verified bool   `json:"verified"`
}

var v3Slots = []string{"pool_slot0", "fee_growth_global0", "fee_growth_global1", "protocol_fees", "liquidity"}
var v4Slots = []string{"pool_slot0", "fee_growth_global0", "fee_growth_global1", "liquidity"}

// ozBalances is OpenZeppelin v5 ERC20's ERC-7201 namespace, whose first member is _balances.
const ozBalances = "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00"

func ContextFromLogs(logs []Log) BlockContext {
	c := BlockContext{V3Pools: map[string]bool{}, V4Pools: map[string]bool{}, V4Ticks: map[string][]int64{}, V4Positions: map[string][]string{}}
	for _, log := range logs {
		if s, err := DecodeSwap(log); err == nil {
			c.V3Pools[s.Pool] = false
		} else if s, err := DecodeSwapV4(log); err == nil {
			c.V4Pools[s.PoolID] = true
			c.V4Ticks[s.PoolID] = appendNew(c.V4Ticks[s.PoolID], s.Tick)
		} else if m, err := decodeModifyLiquidity(log); err == nil {
			c.V4Pools[m.pool] = true
			c.V4Ticks[m.pool] = appendNew(c.V4Ticks[m.pool], m.lower, m.upper)
			c.V4Positions[m.pool] = appendNew(c.V4Positions[m.pool], m.positionKey)
		} else if _, err := managerEvent(log, InitializeTopic, 4, 160); err == nil {
			c.V4Pools[strings.ToLower(log.Topics[1])] = true
		}
	}
	c.manager, c.tokens = c.index()
	return c
}

// LabelLocation names a BAL location (key is 0x+64 lowercase); nil = unlabelled.
// Token-balance labels assume a Solidity mapping layout, so they are never verified.
func LabelLocation(c BlockContext, address, field, key string) *Label {
	address, key = strings.ToLower(address), strings.ToLower(key)
	if c.manager == nil {
		c.manager, c.tokens = c.index()
	}
	if verified, ok := c.V3Pools[address]; ok {
		if field != "storage" {
			return nil
		}
		name := "pool_mapping_or_observation"
		if n, err := bal.Number(key); err == nil && n < uint64(len(v3Slots)) {
			name = v3Slots[n]
		}
		return &Label{"uniswap_v3", name, address, verified}
	}
	if address == PoolManager && len(c.V4Pools) > 0 {
		l, ok := c.manager[key]
		switch {
		case field == "balance":
			l = Label{"uniswap_v4", "native_balance", PoolManager, true}
		case field != "storage":
			return nil
		case !ok:
			l = Label{"uniswap_v4", "pool_manager_other_storage", PoolManager, false}
		}
		return &l
	}
	if l, ok := c.tokens[key]; ok && field == "storage" {
		return &l
	}
	return nil
}

// index derives v4 Pool.State keys (on PoolManager) and token balanceOf[holder] keys (on any token).
func (c BlockContext) index() (manager, tokens map[string]Label) {
	manager, tokens = map[string]Label{}, map[string]Label{}
	for id := range c.V4Pools {
		s, err := PoolStateSlot(id)
		if err != nil {
			continue
		}
		state, _ := new(big.Int).SetString(s[2:], 16)
		for i, name := range v4Slots {
			manager[slotHex(state, int64(i))] = Label{"uniswap_v4", name, id, true}
		}
		// Pool.State: ticks mapping at +4, positions mapping at +6; TickInfo and Position.State span 3 slots.
		for _, tick := range c.V4Ticks[id] {
			base := keccakInt(word32(big.NewInt(tick)), word32(offset(state, 4)))
			for i := int64(0); i < 3; i++ {
				manager[slotHex(base, i)] = Label{"uniswap_v4", "tick_info", id, true}
			}
		}
		for _, key := range c.V4Positions[id] {
			k, err := bytes32(key)
			if err != nil {
				continue
			}
			base := keccakInt(k, word32(offset(state, 6)))
			for i := int64(0); i < 3; i++ {
				manager[slotHex(base, i)] = Label{"uniswap_v4", "position", id, true}
			}
		}
	}
	holders := map[string]string{}
	for pool := range c.V3Pools {
		holders[pool] = "uniswap_v3"
	}
	if len(c.V4Pools) > 0 {
		holders[PoolManager] = "uniswap_v4"
	}
	oz, _ := new(big.Int).SetString(ozBalances[2:], 16)
	slots := []*big.Int{oz}
	for s := int64(0); s <= 20; s++ {
		slots = append(slots, big.NewInt(s))
	}
	for holder, protocol := range holders {
		padded, err := hex.DecodeString(strings.Repeat("0", 24) + strings.TrimPrefix(holder, "0x"))
		if err != nil || len(padded) != 32 {
			continue
		}
		name := "token_balance_of_pool"
		if holder == PoolManager {
			name = "token_balance_of_pool_manager"
		}
		for _, slot := range slots {
			tokens[slotHex(keccakInt(padded, word32(slot)), 0)] = Label{protocol, name, holder, false}
		}
	}
	return manager, tokens
}

func keccakInt(parts ...[]byte) *big.Int {
	h, _ := new(big.Int).SetString(bal.Keccak(bytes.Join(parts, nil))[2:], 16)
	return h
}
func offset(base *big.Int, n int64) *big.Int {
	return new(big.Int).Mod(new(big.Int).Add(base, big.NewInt(n)), two256)
}
func slotHex(base *big.Int, n int64) string { return fmt.Sprintf("0x%064x", offset(base, n)) }

func appendNew[T comparable](s []T, values ...T) []T {
	for _, v := range values {
		if !slices.Contains(s, v) {
			s = append(s, v)
		}
	}
	return s
}
