package uniswap

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"rooted/internal/bal"
	"rooted/internal/remote"
	"strings"
	"testing"
	"time"
)

// StateView is v4-periphery's read lens on Sepolia; its poolManager() returns PoolManager.
const stateView = "0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c"

// liveRPC skips unless ROOTED_TEST_LIVE_EXECUTION names a Sepolia execution RPC.
func liveRPC(t *testing.T) (context.Context, *remote.Client, func(out any, method string, params ...any)) {
	url := os.Getenv("ROOTED_TEST_LIVE_EXECUTION")
	if url == "" {
		t.Skip("set ROOTED_TEST_LIVE_EXECUTION=http://127.0.0.1:18545 for live Sepolia checks")
	}
	ctx, client := context.Background(), remote.New(url, 30*time.Second)
	return ctx, client, func(out any, method string, params ...any) {
		r, err := client.RPC(ctx, method, params)
		var envelope struct{ Result json.RawMessage }
		if err == nil {
			err = json.Unmarshal(r.Body, &envelope)
		}
		if err == nil {
			err = json.Unmarshal(envelope.Result, out)
		}
		if err != nil {
			t.Fatal(method, err)
		}
	}
}

// TestLiveStorageCrossCheck compares labelled raw storage (eth_getStorageAt) with the contracts'
// own getters at one pinned block, using logs from the recent window.
func TestLiveStorageCrossCheck(t *testing.T) {
	ctx, client, rpc := liveRPC(t)
	var head string
	rpc(&head, "eth_blockNumber")
	n, _ := bal.Number(head)
	from := fmt.Sprintf("0x%x", n-1000)
	call := func(_ context.Context, to, data string) (string, error) {
		var out string
		r, err := client.RPC(ctx, "eth_call", []any{map[string]string{"to": to, "data": data}, head})
		if err == nil {
			var envelope struct{ Result string }
			err = json.Unmarshal(r.Body, &envelope)
			out = envelope.Result
		}
		return out, err
	}
	low := func(hexWord string, bits uint) *big.Int {
		v, _ := new(big.Int).SetString(strings.TrimPrefix(hexWord, "0x"), 16)
		if v == nil {
			t.Fatal("bad word", hexWord)
		}
		return v.And(v, new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), bits), big.NewInt(1)))
	}
	storage := func(address, key string) string {
		var out string
		rpc(&out, "eth_getStorageAt", address, key, head)
		return out
	}
	getter := func(to, data string, word int, bits uint) *big.Int {
		r, err := call(ctx, to, data)
		if err != nil || len(r) < 2+64*(word+1) {
			t.Fatal(to, data[:10], r, err)
		}
		return low(r[2+64*word:2+64*(word+1)], bits)
	}
	expect := func(what string, label *Label, name string, raw, want *big.Int) bool {
		if label == nil || label.Name != name || raw.Cmp(want) != 0 {
			t.Fatalf("%s: label %v, storage %s, getter %s", what, label, raw, want)
		}
		return want.Sign() != 0
	}

	var logs, v3Logs []Log
	rpc(&logs, "eth_getLogs", map[string]any{"fromBlock": from, "toBlock": head, "address": PoolManager})
	rpc(&v3Logs, "eth_getLogs", map[string]any{"fromBlock": fmt.Sprintf("0x%x", n-50), "toBlock": head, "topics": []string{SwapTopic}})
	c := ContextFromLogs(append(logs, v3Logs...))
	if len(c.V4Pools) == 0 {
		t.Fatal("no v4 pool activity in the last 1000 blocks")
	}
	nonzero := map[string]int{}
	for id := range c.V4Pools {
		s, _ := PoolStateSlot(id)
		state, _ := new(big.Int).SetString(s[2:], 16)
		if expect("slot0 "+id, LabelLocation(c, PoolManager, "storage", s), "pool_slot0", low(storage(PoolManager, s), 160), getter(stateView, "0xc815641c"+id[2:], 0, 160)) {
			nonzero["pool_slot0"]++
		}
		liquidity := slotHex(state, 3)
		if expect("liquidity "+id, LabelLocation(c, PoolManager, "storage", liquidity), "liquidity", low(storage(PoolManager, liquidity), 128), getter(stateView, "0xfa6793d5"+id[2:], 0, 128)) {
			nonzero["liquidity"]++
		}
		for _, tick := range c.V4Ticks[id] {
			key := slotHex(keccakInt(word32(big.NewInt(tick)), word32(offset(state, 4))), 0)
			if expect(fmt.Sprint("tick ", tick), LabelLocation(c, PoolManager, "storage", key), "tick_info", low(storage(PoolManager, key), 128), getter(stateView, fmt.Sprintf("0x7c40f1fe%s%x", id[2:], word32(big.NewInt(tick))), 0, 128)) {
				nonzero["tick_info"]++
			}
		}
	}
	// getPositionInfo(poolId, owner, tickLower, tickUpper, salt) derives the position key itself.
	for _, log := range logs {
		m, err := decodeModifyLiquidity(log)
		if err != nil {
			continue
		}
		s, _ := PoolStateSlot(m.pool)
		state, _ := new(big.Int).SetString(s[2:], 16)
		k, _ := bytes32(m.positionKey)
		key := slotHex(keccakInt(k, word32(offset(state, 6))), 0)
		data := "0xdacf1d2f" + m.pool[2:] + log.Topics[2][2:] + log.Data[2:2+128] + log.Data[2+192:]
		if expect("position "+m.positionKey, LabelLocation(c, PoolManager, "storage", key), "position", low(storage(PoolManager, key), 128), getter(stateView, data, 0, 128)) {
			nonzero["position"]++
		}
	}
	// ERC20 balanceOf(PoolManager) vs. the labelled balance slot, for tokens sent to PoolManager recently.
	var transfers []Log
	rpc(&transfers, "eth_getLogs", map[string]any{"fromBlock": fmt.Sprintf("0x%x", n-100), "toBlock": head, "topics": []any{"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", nil, "0x" + wordTopic(PoolManager)[2:]}})
	tokens := map[string]bool{}
	for _, l := range transfers {
		tokens[strings.ToLower(l.Address)] = true
	}
	matched := 0
	for token := range tokens {
		r, err := call(ctx, token, "0x70a08231"+wordTopic(PoolManager)[2:])
		if err != nil || len(r) != 66 {
			continue
		}
		balance := low(r, 256)
		for key, l := range c.tokens {
			if l.Pool == PoolManager && balance.Sign() != 0 && low(storage(token, key), 256).Cmp(balance) == 0 && LabelLocation(c, token, "storage", key).Name == "token_balance_of_pool_manager" {
				matched++
				break
			}
		}
	}
	// v3: factory verification, then slot0 / liquidity against the pool's getters.
	VerifyV3Pools(ctx, call, &c)
	verified := 0
	for pool, ok := range c.V3Pools {
		if !ok {
			continue
		}
		verified++
		expect("v3 slot0 "+pool, LabelLocation(c, pool, "storage", slotHex(big.NewInt(0), 0)), "pool_slot0", low(storage(pool, slotHex(big.NewInt(0), 0)), 160), getter(pool, "0x3850c7bd", 0, 160))
		expect("v3 liquidity "+pool, LabelLocation(c, pool, "storage", slotHex(big.NewInt(4), 0)), "liquidity", low(storage(pool, slotHex(big.NewInt(4), 0)), 256), getter(pool, "0x1a686502", 0, 128))
	}
	t.Logf("block %d: %d v4 pools, nonzero matches %v; %d/%d tokens matched balanceOf(PoolManager); %d/%d v3 candidates factory-verified", n, len(c.V4Pools), nonzero, matched, len(tokens), verified, len(c.V3Pools))
	if nonzero["pool_slot0"] == 0 || nonzero["position"] == 0 || matched == 0 || verified == 0 {
		t.Fatal("cross-check found no non-zero evidence", nonzero, matched, verified)
	}
}

// TestLiveBALContention labels the real EIP-7928 BAL (Nimbus payload envelope, commitment-checked) of
// Sepolia block 12073969, where three txs swap the same factory v3 pool (fETH/f564, 0.3%).
func TestLiveBALContention(t *testing.T) {
	ctx, _, rpc := liveRPC(t)
	beacon := os.Getenv("ROOTED_TEST_LIVE_BEACON")
	if beacon == "" {
		t.Skip("set ROOTED_TEST_LIVE_BEACON=http://127.0.0.1:15052 too")
	}
	var block struct {
		Hash, SlotNumber, BlockAccessListHash string
		Transactions                          []string
	}
	rpc(&block, "eth_getBlockByNumber", "0xb83bf1", false)
	var receipts []struct{ Logs []Log }
	rpc(&receipts, "eth_getBlockReceipts", block.Hash)
	var logs []Log
	for _, r := range receipts {
		logs = append(logs, r.Logs...)
	}
	slot, _ := bal.Number(block.SlotNumber)
	record, err := remote.New(beacon, 30*time.Second).Get(ctx, fmt.Sprintf("/eth/v1/beacon/execution_payload_envelopes/%d", slot), "uniswap_live_test")
	var envelope struct {
		Data struct {
			Message struct {
				Payload struct {
					Hash string `json:"block_hash"`
					BAL  string `json:"block_access_list"`
				}
			}
		}
	}
	if err == nil {
		err = json.Unmarshal(record.Body, &envelope)
	}
	if err != nil || envelope.Data.Message.Payload.Hash != block.Hash {
		t.Fatal("envelope", err)
	}
	native, err := bal.DecodeNativeRLP(envelope.Data.Message.Payload.BAL, len(block.Transactions), block.BlockAccessListHash)
	if err != nil || native.CommitmentVerified == nil || !*native.CommitmentVerified {
		t.Fatal("BAL", err)
	}
	c := ContextFromLogs(logs)
	pool := "0x6a8bcbc98ff2485582049e67299fb16ad900728b"
	var slot0Writers []uint64
	for _, ch := range native.Changes {
		if ch.TransactionIndex != nil && ch.Address == pool && ch.Field == "storage" && LabelLocation(c, ch.Address, ch.Field, ch.Key).Name == "pool_slot0" {
			slot0Writers = append(slot0Writers, *ch.TransactionIndex)
		}
	}
	labelled := 0
	for _, e := range bal.BuildGraph(bal.NativeAccess(native, block.Transactions), false, 100000).Edges {
		if LabelLocation(c, e.Location.Address, e.Location.Field, e.Location.Key) != nil {
			labelled++
		}
	}
	t.Logf("block %s: pool_slot0 writers %v, %d labelled BAL write edges", block.Hash, slot0Writers, labelled)
	if fmt.Sprint(slot0Writers) != "[29 35 83]" || labelled != 12 {
		t.Fatal(slot0Writers, labelled)
	}
}
