package uniswap

import (
	"context"
	"fmt"
	"rooted/internal/bal"
	"slices"
	"strings"
)

// Caller is an eth_call (to, data) -> 0x result, bound to one block by the caller.
type Caller func(ctx context.Context, to, data string) (string, error)

const maxVerifiedPools = 8

// VerifyV3Pools marks up to 8 unverified Swap-log candidates (sorted; best effort) as verified when
// the pool reports the official factory and factory.getPool(token0, token1, fee) returns it.
func VerifyV3Pools(ctx context.Context, call Caller, c *BlockContext) {
	var pending []string
	for pool, verified := range c.V3Pools {
		if !verified {
			pending = append(pending, pool)
		}
	}
	slices.Sort(pending)
	for _, pool := range pending[:min(len(pending), maxVerifiedPools)] {
		if ctx.Err() != nil {
			return
		}
		c.V3Pools[pool] = factoryPool(ctx, call, pool)
	}
}

// factoryPool uses the selectors of internal/analysis/pool.go: factory, token0, token1, fee, getPool.
func factoryPool(ctx context.Context, call Caller, pool string) bool {
	address := func(to, data string) string {
		r, err := call(ctx, to, data)
		if err != nil || len(r) != 66 || !strings.HasPrefix(r, "0x") || r[2:26] != strings.Repeat("0", 24) {
			return ""
		}
		a, _ := bal.Address("0x" + r[26:])
		return a
	}
	if address(pool, "0xc45a0155") != Factory {
		return false
	}
	token0, token1 := address(pool, "0x0dfe1681"), address(pool, "0xd21220a7")
	if token0 == "" || token1 == "" {
		return false
	}
	r, err := call(ctx, pool, "0xddca3f43")
	fee, e := bal.Number(r)
	if err != nil || e != nil || fee >= 1<<24 {
		return false
	}
	pad := func(a string) string { return strings.Repeat("0", 24) + a[2:] }
	return address(Factory, "0x1698ee82"+pad(token0)+pad(token1)+fmt.Sprintf("%064x", fee)) == pool
}
