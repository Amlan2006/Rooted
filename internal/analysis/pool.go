package analysis

import (
	"context"
	"errors"
	"fmt"
	"rooted/internal/bal"
	"rooted/internal/uniswap"
	"strconv"
	"strings"
)

func parseDecimal(s string) (uint64, error) { return strconv.ParseUint(s, 10, 64) }
func (c *Collector) pool(ctx context.Context, f *fetch, address, blockHash, number string) uniswap.Pool {
	p := uniswap.Pool{Address: address, Coverage: []string{}}
	call := func(to, data string) (string, error) {
		var result string
		err := f.rpc(ctx, c.Execution, "eth_call", address+":"+data[:10], []any{map[string]any{"to": to, "data": data}, map[string]any{"blockHash": blockHash, "requireCanonical": true}}, &result)
		if err != nil {
			err = f.rpc(ctx, c.Execution, "eth_call", address+":"+data[:10]+":number", []any{map[string]any{"to": to, "data": data}, number}, &result)
			p.Coverage = append(p.Coverage, "metadata_block_number_fallback_checked_against_final_header")
		}
		return result, err
	}
	addr := func(selector string) (string, error) {
		r, err := call(address, selector)
		if err != nil || len(r) != 66 || !strings.HasPrefix(r, "0x") || r[2:26] != strings.Repeat("0", 24) {
			return "", errors.New("invalid pool address response")
		}
		return bal.Address("0x" + r[len(r)-40:])
	}
	var err error
	p.Factory, err = addr("0xc45a0155")
	if err != nil || p.Factory != uniswap.Factory {
		p.Coverage = append(p.Coverage, "official_v3_factory_not_verified")
		return p
	}
	p.Token0, err = addr("0x0dfe1681")
	if err != nil {
		return p
	}
	p.Token1, err = addr("0xd21220a7")
	if err != nil {
		return p
	}
	fee, err := call(address, "0xddca3f43")
	if err != nil {
		return p
	}
	p.Fee, err = bal.Number(fee)
	if err != nil || p.Fee > 1<<24-1 {
		return p
	}
	// getPool(address,address,uint24), using full ABI words without floating point.
	word := func(address string) string { return strings.Repeat("0", 24) + address[2:] }
	feeWord := fmt.Sprintf("%064x", p.Fee)
	data := "0x1698ee82" + word(p.Token0) + word(p.Token1) + feeWord
	result, err := call(uniswap.Factory, data)
	if err == nil && len(result) == 66 && strings.HasPrefix(result, "0x") && result[2:26] == strings.Repeat("0", 24) && strings.EqualFold(result[len(result)-40:], address[2:]) {
		p.Verified = true
	} else {
		p.Coverage = append(p.Coverage, "factory_getPool_did_not_confirm_address")
	}
	return p
}
