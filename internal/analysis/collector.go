package analysis

import (
	"context"
	"encoding/json"
	"errors"
	"rooted/internal/bal"
	"rooted/internal/domain"
	"rooted/internal/ingest"
	"rooted/internal/remote"
	"rooted/internal/uniswap"
	"sort"
	"strings"
	"time"
)

type Collector struct {
	AnchorNumber, AnchorHash string
	Execution, Trace         remote.Execution
	Beacon                   remote.Beacon
	Network, Mode, ChainID   string
	Native                   bool
	OpcodeLimit              int
}
type fetch struct{ records []domain.RawRecord }

func (f *fetch) rpc(ctx context.Context, client remote.Execution, method, entity string, params []any, out any) error {
	record, err := client.RPC(ctx, method, params)
	record.Kind = method + ":" + entity
	if len(record.Body) > 0 {
		f.records = append(f.records, record)
	}
	if err != nil {
		return err
	}
	var response struct {
		Result json.RawMessage `json:"result"`
	}
	if err = json.Unmarshal(record.Body, &response); err != nil {
		return err
	}
	if len(response.Result) == 0 {
		return errors.New("missing RPC result")
	}
	return json.Unmarshal(response.Result, out)
}
func (c *Collector) Fetch(ctx context.Context, hash string, selected []string) (Snapshot, error) {
	var snapshot Snapshot
	if !ingest.ValidRoot(hash) || len(selected) > 4 {
		return snapshot, errors.New("need a block hash and at most four traced transactions")
	}
	hash = strings.ToLower(hash)
	selected = append([]string{}, selected...)
	for i := range selected {
		selected[i] = strings.ToLower(selected[i])
	}
	sort.Strings(selected)
	f := &fetch{}
	r := Run{Network: c.Network, Mode: c.Mode, ChainID: c.ChainID, Pools: []uniswap.Pool{}, Swaps: []uniswap.Swap{}, Attempts: []uniswap.Attempt{}, Transactions: []TxResult{}, Coverage: []string{}, StorageLabels: map[string]string{}}
	var chain string
	if err := f.rpc(ctx, c.Execution, "eth_chainId", "execution", []any{}, &chain); err != nil {
		return snapshot, err
	}
	n, e := bal.Number(chain)
	expected, ee := parseDecimal(c.ChainID)
	if e != nil || ee != nil || n != expected {
		return snapshot, errors.New("analysis execution chain mismatch")
	}
	anchorNumber, anchorHash := c.AnchorNumber, c.AnchorHash
	if anchorNumber == "" {
		anchorNumber = "0xf4240"
	}
	if anchorHash == "" {
		anchorHash = "0xaad11ee5a3b4b037a4cef3afd30398bf8b0f73e702cf86f86e3f4eaa9d7d39a2"
	}
	var anchor *Block
	if err := f.rpc(ctx, c.Execution, "eth_getBlockByNumber", "network_anchor", []any{anchorNumber, false}, &anchor); err != nil || anchor == nil || !strings.EqualFold(anchor.Hash, anchorHash) || anchor.Number != anchorNumber {
		return snapshot, errors.New("execution network anchor mismatch or unavailable")
	}
	r.Anchor = Anchor{Number: anchor.Number, Hash: strings.ToLower(anchor.Hash)}

	var block *Block
	if err := f.rpc(ctx, c.Execution, "eth_getBlockByHash", hash, []any{hash, true}, &block); err != nil || block == nil || !strings.EqualFold(block.Hash, hash) {
		return snapshot, errors.New("analysis block identity mismatch or unavailable")
	}
	if len(block.Transactions) > 2000 {
		return snapshot, errors.New("block exceeds analysis transaction bound")
	}
	r.Block = *block
	hashes := make([]string, len(block.Transactions))
	for i, t := range block.Transactions {
		if !ingest.ValidRoot(t.Hash) {
			return snapshot, errors.New("invalid block transaction hash")
		}
		hashes[i] = strings.ToLower(t.Hash)
	}
	if c.Native {
		native, err := c.nativeBAL(ctx, f, block)
		if err != nil {
			return snapshot, err
		}
		r.Native = &native
		r.Access = bal.NativeAccess(native, hashes)
		if native.CommitmentVerified == nil {
			r.Coverage = append(r.Coverage, "native_bal_header_commitment_unavailable")
		}
	} else {
		r.Access = bal.NativeAccess(bal.Native{}, hashes)
		for i := range r.Access {
			r.Access[i].Coverage = []string{"trace_only_no_native_bal"}
		}
		r.Coverage = append(r.Coverage, "trace_only_fork_not_native_bal_evidence")
	}
	if len(selected) > 0 {
		var traceChain string
		var traceAnchor *Block
		if f.rpc(ctx, c.Trace, "eth_chainId", "trace", []any{}, &traceChain) != nil || f.rpc(ctx, c.Trace, "eth_getBlockByNumber", "trace_anchor", []any{anchorNumber, false}, &traceAnchor) != nil || traceAnchor == nil || !strings.EqualFold(traceAnchor.Hash, r.Anchor.Hash) || traceChain != chain {
			return snapshot, errors.New("trace provider network identity mismatch")
		}
	}
	seen := map[string]bool{}
	poolCandidates := map[string]bool{}
	for _, requested := range selected {
		txHash := strings.ToLower(requested)
		if !ingest.ValidRoot(txHash) || seen[txHash] {
			return snapshot, errors.New("invalid or duplicate selected transaction")
		}
		seen[txHash] = true
		index := -1
		for i, h := range hashes {
			if h == txHash {
				index = i
				break
			}
		}
		if index < 0 {
			return snapshot, errors.New("selected transaction is not in this block")
		}
		tx := block.Transactions[index]
		if tx.From == "" {
			if err := f.rpc(ctx, c.Execution, "eth_getTransactionByHash", txHash, []any{txHash}, &tx); err != nil {
				return snapshot, err
			}
		}
		var receipt *Receipt
		if err := f.rpc(ctx, c.Execution, "eth_getTransactionReceipt", txHash, []any{txHash}, &receipt); err != nil || receipt == nil {
			return snapshot, errors.New("selected receipt unavailable")
		}
		ri, err := bal.Number(receipt.Index)
		if err != nil || ri != uint64(index) || !strings.EqualFold(receipt.Hash, txHash) || !strings.EqualFold(receipt.BlockHash, hash) || receipt.BlockNumber != block.Number || tx.Hash != txHash || tx.BlockHash != hash || tx.Index != receipt.Index || (receipt.Status != "0x0" && receipt.Status != "0x1") {
			return snapshot, errors.New("analysis transaction/receipt/block mismatch")
		}
		result := TxResult{Transaction: tx, Receipt: *receipt, Coverage: []string{}}
		access := &r.Access[index]
		if from, err := bal.Address(tx.From); err == nil {
			bal.AddRead(access, bal.Location{Address: from, Field: "nonce"})
			bal.AddRead(access, bal.Location{Address: from, Field: "balance"})
		}
		if tx.To != nil {
			if to, err := bal.Address(*tx.To); err == nil {
				bal.AddRead(access, bal.Location{Address: to, Field: "code"})
			}
		}
		for _, log := range receipt.Logs {
			if len(log.Topics) > 0 && strings.EqualFold(log.Topics[0], uniswap.SwapTopic) {
				if receipt.Status != "0x1" || !strings.EqualFold(log.Hash, txHash) || !strings.EqualFold(log.BlockHash, hash) {
					return snapshot, errors.New("swap event does not match successful receipt")
				}
				swap, err := uniswap.DecodeSwap(log)
				if err != nil {
					return snapshot, err
				}
				r.Swaps = append(r.Swaps, swap)
				poolCandidates[swap.Pool] = true
			}
		}
		var traceTx *Transaction
		if err = f.rpc(ctx, c.Trace, "eth_getTransactionByHash", "trace_before:"+txHash, []any{txHash}, &traceTx); err != nil || traceTx == nil || traceTx.Hash != txHash || traceTx.BlockHash != hash || traceTx.Index != receipt.Index {
			result.Coverage = append(result.Coverage, "trace_provider_transaction_binding_unavailable")
			r.Transactions = append(r.Transactions, result)
			continue
		}
		// Stage supplemental evidence until the provider's transaction binding has
		// been checked again after replay. No unbound trace mutates the access model.
		staged := *access
		staged.Reads = append([]bal.Location{}, access.Reads...)
		staged.Writes = append([]bal.Location{}, access.Writes...)
		staged.Candidates = append([]bal.Location{}, access.Candidates...)
		staged.Coverage = append([]string{}, access.Coverage...)
		var calls uniswap.Call
		callErr := f.rpc(ctx, c.Trace, "debug_traceTransaction", "calls:"+txHash, []any{txHash, map[string]any{"tracer": "callTracer", "timeout": "10s"}}, &calls)
		if callErr == nil && (calls.Type == "" || !strings.EqualFold(calls.From, tx.From) || (tx.To != nil && !strings.EqualFold(calls.To, *tx.To))) {
			callErr = errors.New("call trace root does not match transaction")
			result.Coverage = append(result.Coverage, "call_trace_root_schema_mismatch")
		}
		var pre json.RawMessage
		if f.rpc(ctx, c.Trace, "debug_traceTransaction", "prestate:"+txHash, []any{txHash, map[string]any{"tracer": "prestateTracer", "timeout": "10s"}}, &pre) == nil {
			if err = bal.AddPrestate(&staged, pre); err != nil {
				result.Coverage = append(result.Coverage, "prestate_schema_unavailable")
			}
		}
		var diff json.RawMessage
		if c.Native {
			if f.rpc(ctx, c.Execution, "trace_replayTransaction", "diff:"+txHash, []any{txHash, []string{"stateDiff"}}, &diff) == nil {
				var checked bal.Access
				result.StateDiffAvailable = bal.AddParityDiff(&checked, diff) == nil /* Native BAL remains the committed-write authority. */
			}
		}
		if !c.Native {
			if f.rpc(ctx, c.Trace, "debug_traceTransaction", "diff:"+txHash, []any{txHash, map[string]any{"tracer": "prestateTracer", "tracerConfig": map[string]any{"diffMode": true}, "timeout": "10s"}}, &diff) == nil && bal.AddGethDiff(&staged, diff) == nil {
				result.StateDiffAvailable = true
			} else {
				result.Coverage = append(result.Coverage, "committed_write_diff_unavailable")
			}
		}
		limit := c.OpcodeLimit
		if limit <= 0 {
			limit = 20000
		}
		var op json.RawMessage
		if f.rpc(ctx, c.Trace, "debug_traceTransaction", "opcodes:"+txHash, []any{txHash, map[string]any{"disableMemory": true, "disableStorage": true, "disableStack": false, "enableReturnData": false, "timeout": "10s", "limit": limit}}, &op) == nil {
			root := ""
			if tx.To != nil {
				root = *tx.To
			} else if receipt.Contract != nil {
				root = *receipt.Contract
			}
			if bal.AddOpcodes(&staged, op, root, limit) == nil {
				result.OpcodeTraceAvailable = true
			}
		}
		if !result.OpcodeTraceAvailable {
			staged.Coverage = append(staged.Coverage, "per_transaction_opcode_read_history_unavailable")
		}
		traceTx = nil
		if f.rpc(ctx, c.Trace, "eth_getTransactionByHash", "trace_after:"+txHash, []any{txHash}, &traceTx) == nil && traceTx != nil && traceTx.Hash == txHash && traceTx.BlockHash == hash && traceTx.Index == receipt.Index {
			*access = staged
			result.CallTraceAvailable = callErr == nil
			if callErr == nil {
				attempts := uniswap.Attempts(calls, txHash, receipt.Status == "0x0")
				for _, a := range attempts {
					poolCandidates[a.Pool] = true
				}
				r.Attempts = append(r.Attempts, attempts...)
			}
		} else {
			result.CallTraceAvailable = false
			result.StateDiffAvailable = false
			result.OpcodeTraceAvailable = false
			result.Coverage = append(result.Coverage, "trace_provider_binding_changed_evidence_not_applied")
		}

		r.Transactions = append(r.Transactions, result)
	}
	pools := []string{}
	for p := range poolCandidates {
		pools = append(pools, p)
	}
	sort.Strings(pools)
	for _, p := range pools {
		pool := c.pool(ctx, f, p, hash, block.Number)
		r.Pools = append(r.Pools, pool)
		if pool.Verified {
			for i := range r.Swaps {
				if r.Swaps[i].Pool == p {
					r.Swaps[i].PoolVerified = true
				}
			}
			for i := range r.Attempts {
				if r.Attempts[i].Pool == p {
					r.Attempts[i].PoolVerified = true
				}
			}
			for _, access := range r.Access {
				for _, l := range append(append([]bal.Location{}, access.Reads...), access.Writes...) {
					if l.Address == p && l.Field == "storage" {
						r.StorageLabels[l.ID()] = uniswap.StorageLabel(l.Key)
					}
				}
			}
		}
	}
	var canonical *Block
	if f.rpc(ctx, c.Execution, "eth_getBlockByNumber", "canonical_final", []any{block.Number, false}, &canonical) == nil && canonical != nil {
		v := strings.EqualFold(canonical.Hash, hash)
		r.Canonical = &v
	}
	// Number-based metadata is usable only while the requested block remains
	// canonical. Never mark reorged/unconfirmed fallback metadata verified.
	for i := range r.Pools {
		for _, coverage := range r.Pools[i].Coverage {
			if coverage == "metadata_block_number_fallback_checked_against_final_header" && (r.Canonical == nil || !*r.Canonical) {
				r.Pools[i].Verified = false
				r.Pools[i].Coverage = append(r.Pools[i].Coverage, "metadata_canonical_binding_unavailable")
				for j := range r.Swaps {
					if r.Swaps[j].Pool == r.Pools[i].Address {
						r.Swaps[j].PoolVerified = false
					}
				}
				for j := range r.Attempts {
					if r.Attempts[j].Pool == r.Pools[i].Address {
						r.Attempts[j].PoolVerified = false
					}
				}
			}
		}
	}

	for i := range r.Access {
		a := &r.Access[i]
		for _, list := range [][]bal.Location{a.Reads, a.Writes, a.Candidates} {
			sort.Slice(list, func(i, j int) bool { return list[i].ID() < list[j].ID() })
		}
		sort.Strings(a.Coverage)
	}

	r.Graph = bal.BuildGraph(r.Access, false, 100000)
	r.StorageGraph = bal.BuildGraph(r.Access, true, 100000)
	if len(selected) < len(hashes) {
		r.Coverage = append(r.Coverage, "unselected_transactions_have_no_attributed_read_trace")
	}
	r.Coverage = append(r.Coverage, "no_measured_parallel_execution_speedup", "gas_used_is_whole_transaction_not_pool_exclusive")
	if err := ctx.Err(); err != nil {
		return snapshot, err
	}
	r.CreatedAt = time.Now().UTC()
	for _, record := range f.records {
		r.Sources = append(r.Sources, record.Source)
	}
	selection := append([]string{}, selected...)
	sort.Strings(selection)
	r.ID = bal.Keccak([]byte("analysis-v1|" + r.Network + "|" + r.Mode + "|" + r.Anchor.Hash + "|" + hash + "|" + strings.Join(selection, ",")))
	snapshot = Snapshot{Run: r, Records: f.records}
	return snapshot, nil
}
