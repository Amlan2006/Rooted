package uniswap

import (
	"slices"
	"strings"
	"testing"
)

// Goldens below were computed independently with `cast index` / `cast keccak` (foundry 1.9.0).
const (
	fixtureState = "0x25176be66374e14cbc4a353bff11c16d795612d9379ed4ec884fdbb8258fdc4" // + last nibble 0..4
	tick3756     = "0x8ae58d721cdd7aa5356c171c90393674151a9d03ad60ea0f237e4dc962a0f93" // + 6 (offset 0), 8, 9
	position     = "0x0b11df72b5bbf4db5eb97f63b51ecd5aa94534b983c4fefbbd6203e2f079c1"  // + 1f (offset 0), 21
	v3Pool       = "0xa65eae43b1f7087d96e04a82d04e15e4243b11f5"
	usdc         = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" // any token contract
)

func TestContextFromLogsRealBlock(t *testing.T) {
	logs := fixtureLogs(t)
	c := ContextFromLogs(logs)
	if len(c.V3Pools) != 3 || c.V3Pools[v3Pool] || len(c.V4Pools) != 1 || !c.V4Pools[fixturePool] {
		t.Fatal(c.V3Pools, c.V4Pools)
	}
	// ModifyLiquidity ranges [3734,3735] [3755,3756] x2 [3745,3746] plus Swap tick 3756, deduplicated.
	if !slices.Equal(c.V4Ticks[fixturePool], []int64{3734, 3735, 3755, 3756, 3745, 3746}) || len(c.V4Positions[fixturePool]) != 3 {
		t.Fatal(c.V4Ticks, c.V4Positions)
	}
	// cast keccak of abi.encodePacked(0x85e2…2e7a, int24 3755, int24 3756, bytes32 0).
	if !slices.Contains(c.V4Positions[fixturePool], "0xc92628d94c121b8b83da28c33a0f3c46ec8678242a948ea0ac14cfe723beb500") {
		t.Fatal(c.V4Positions)
	}
	initialize := Log{Address: PoolManager, Topics: []string{InitializeTopic, "0x" + word(7), "0x" + word(0), "0x" + word(1)}, Data: "0x" + strings.Repeat(word(1), 5)}
	if c = ContextFromLogs([]Log{initialize}); !c.V4Pools["0x"+word(7)] || len(c.V4Ticks) != 0 {
		t.Fatal("Initialize not recorded", c)
	}
	for i := range logs {
		logs[i].Removed = true
	}
	if c = ContextFromLogs(logs); len(c.V3Pools)+len(c.V4Pools) != 0 {
		t.Fatal("removed logs used", c)
	}
}

func TestLabelLocation(t *testing.T) {
	c := ContextFromLogs(fixtureLogs(t))
	c.V3Pools[v3Pool] = true // as after VerifyV3Pools
	pm, upperPM, v3, v4 := PoolManager, strings.ToUpper(PoolManager[2:]), "uniswap_v3", "uniswap_v4"
	slot := func(n int64) string { return "0x" + word(n) }
	for _, tc := range []struct {
		protocol, address, field, key, name, pool string
		verified                                  bool
	}{
		{v3, v3Pool, "storage", slot(0), "pool_slot0", v3Pool, true},
		{v3, v3Pool, "storage", slot(1), "fee_growth_global0", v3Pool, true},
		{v3, v3Pool, "storage", slot(2), "fee_growth_global1", v3Pool, true},
		{v3, v3Pool, "storage", slot(3), "protocol_fees", v3Pool, true},
		{v3, v3Pool, "storage", slot(4), "liquidity", v3Pool, true},
		{v3, v3Pool, "storage", slot(8), "pool_mapping_or_observation", v3Pool, true},
		{v3, "0xfc060575fb9e7f918c52db5f760b2a28a7fa260a", "storage", slot(4), "liquidity", "0xfc060575fb9e7f918c52db5f760b2a28a7fa260a", false},
		{v4, "0x" + upperPM, "storage", fixtureState + "0", "pool_slot0", fixturePool, true},
		{v4, pm, "storage", fixtureState + "1", "fee_growth_global0", fixturePool, true},
		{v4, pm, "storage", fixtureState + "2", "fee_growth_global1", fixturePool, true},
		{v4, pm, "storage", fixtureState + "3", "liquidity", fixturePool, true},
		{v4, pm, "storage", fixtureState + "4", "pool_manager_other_storage", pm, false}, // ticks mapping slot itself
		{v4, pm, "storage", tick3756 + "6", "tick_info", fixturePool, true},
		{v4, pm, "storage", tick3756 + "8", "tick_info", fixturePool, true},
		{v4, pm, "storage", tick3756 + "9", "pool_manager_other_storage", pm, false},
		{v4, pm, "storage", position + "1f", "position", fixturePool, true},
		{v4, pm, "storage", position + "21", "position", fixturePool, true},
		{v4, pm, "balance", "", "native_balance", pm, true},
		{v4, usdc, "storage", "0xf3708e07f8ddf1001a810cda4368d25bee59fa74296674098ecd84c2ac57c482", "token_balance_of_pool_manager", pm, false}, // slot 9
		{v4, usdc, "storage", "0xbe049d36d9cc93624e5919d6c8466bea495358c8268b94b7509e6295f2de2ba8", "token_balance_of_pool_manager", pm, false}, // OZ v5
		{v3, usdc, "storage", "0x7ed7a4868d43418138c787be2d80f20379c606cae35bf283d81e945f78091d5d", "token_balance_of_pool", v3Pool, false},     // slot 0
	} {
		l := LabelLocation(c, tc.address, tc.field, tc.key)
		if l == nil || *l != (Label{tc.protocol, tc.name, tc.pool, tc.verified}) {
			t.Error(tc.name, tc.key, l)
		}
	}
	for _, tc := range [][3]string{
		{pm, "nonce", ""},
		{v3Pool, "balance", ""},
		{usdc, "balance", "0x7ed7a4868d43418138c787be2d80f20379c606cae35bf283d81e945f78091d5d"},
		{usdc, "storage", slot(0)},
	} {
		if l := LabelLocation(c, tc[0], tc[1], tc[2]); l != nil {
			t.Error(tc, *l)
		}
	}
	if l := LabelLocation(BlockContext{}, pm, "storage", fixtureState+"0"); l != nil {
		t.Fatal("zero context labelled", *l)
	}
	literal := BlockContext{V4Pools: map[string]bool{fixturePool: true}} // no derived index
	if l := LabelLocation(literal, pm, "storage", fixtureState+"3"); l == nil || l.Name != "liquidity" {
		t.Fatal(l)
	}
}
