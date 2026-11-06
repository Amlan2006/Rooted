package uniswap

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestVerifyV3Pools(t *testing.T) {
	pad := func(a string) string { return "0x" + wordTopic(a)[2:] }
	addr := func(n int) string { return fmt.Sprintf("0x%040x", n) }
	good, wrongFactory, notFromFactory, preverified := addr(0xa1), addr(0xa2), addr(0xa3), addr(0x01)
	token1 := addr(0x11)
	c := BlockContext{V3Pools: map[string]bool{good: false, wrongFactory: false, notFromFactory: false, preverified: true}}
	for i := 0; i < 7; i++ {
		c.V3Pools[addr(0xb0+i)] = false // erroring candidates; sorted after the a* pools
	}
	called := map[string]int{}
	call := func(_ context.Context, to, data string) (string, error) {
		called[to]++
		if to[len(to)-2] == 'b' { // b* pools: RPC failure
			return "", errors.New("rpc down")
		}
		switch data[:10] {
		case "0xc45a0155":
			if to == wrongFactory {
				return pad(addr(0xff)), nil
			}
			return pad(Factory), nil
		case "0x0dfe1681": // token0 = the pool itself, so getPool can tell pools apart
			return pad(to), nil
		case "0xd21220a7":
			return pad(token1), nil
		case "0xddca3f43":
			return "0x" + word(3000), nil
		case "0x1698ee82":
			if to != Factory || len(data) != 10+3*64 || data[10+128:] != word(3000) || data[10+64:10+128] != wordTopic(token1)[2:] {
				return "", errors.New("bad getPool calldata")
			}
			if token0 := "0x" + data[10+24:10+64]; token0 != notFromFactory {
				return pad(token0), nil
			}
			return pad(addr(0xee)), nil
		}
		return "", errors.New("unexpected call")
	}
	VerifyV3Pools(context.Background(), call, &c)
	if !c.V3Pools[good] || c.V3Pools[wrongFactory] || c.V3Pools[notFromFactory] || !c.V3Pools[preverified] || called[preverified] != 0 {
		t.Fatal(c.V3Pools, called)
	}
	// sorted budget of 8: a1, a2, a3, b0..b4; b5 and b6 are never called
	if called[addr(0xb4)] == 0 || called[addr(0xb5)] != 0 || called[addr(0xb6)] != 0 {
		t.Fatal("8-pool budget not applied in sorted order", called)
	}
	c.V3Pools[good] = false
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	VerifyV3Pools(ctx, call, &c)
	if c.V3Pools[good] {
		t.Fatal("verified after cancellation")
	}
}
