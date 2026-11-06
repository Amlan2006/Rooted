package framemempool

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"rooted/internal/ingest"
	"strings"
	"time"
)

type Collector struct {
	Scope        Scope
	Store        *Store
	Node         RPC
	Execution    RPC
	ChainID      uint64
	Genesis      string
	WSURL        string
	Interval     time.Duration
	MaxPages     int
	PageSize     int
	RefreshLimit int
	Logger       *slog.Logger
}

func (c *Collector) verify(ctx context.Context) (NodeState, error) {
	info, genesis, records, err := verifyIdentity(ctx, c.Node, c.Execution, c.ChainID, c.Genesis)
	if err != nil {
		return NodeState{}, err
	}
	if client, ok := c.Node.(*Client); ok {
		u, _ := url.Parse(client.URL)
		info.Origin = u.Scheme + "://" + u.Host
	}
	return c.Store.Register(ctx, c.Scope, info, genesis, records, records[0].At)
}
func (c *Collector) Run(ctx context.Context) {
	interval := c.Interval
	if interval <= 0 {
		interval = 12 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for ctx.Err() == nil {
		err := c.Poll(ctx)
		if err != nil && ctx.Err() == nil {
			n, nodeErr := c.Store.Node(ctx, c.Scope)
			if nodeErr == nil {
				_ = c.Store.Status(ctx, c.Scope, n.Info.Boot, "poll", "error", n.Cursor)
			}
			if c.Logger != nil {
				c.Logger.WarnContext(ctx, "frame node polling failed; retrying", "node", c.Scope.Node, "error", err.Error())
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (c *Collector) Poll(ctx context.Context) error {
	n, err := c.verify(ctx)
	if err != nil {
		return err
	}
	boot := n.Info.Boot
	pages := c.MaxPages
	if pages <= 0 {
		pages = 2
	}
	size := c.PageSize
	if size <= 0 {
		size = 50
	}
	cursor := ""
	var next *string
	// Always revisit the head, then continue the durable historical scan. Outcomes
	// on older admission IDs are mutable, so a newest-ID watermark alone is unsafe.
	for page := 0; page < pages; page++ {
		if page == 1 && n.Cursor != nil {
			cursor = *n.Cursor
		}
		options := map[string]any{"limit": size}
		if cursor != "" {
			options["cursor"] = cursor
		}
		var result Page
		r, err := c.Node.Call(ctx, "skandha_explorer_listAdmissions", []any{options}, &result)
		r.Entity = "cursor:" + cursor
		if saveErr := c.Store.Raw(ctx, c.Scope, boot, r); saveErr != nil {
			return saveErr
		}
		if err != nil {
			return err
		}
		for _, a := range result.Items {
			if err = c.Fetch(ctx, boot, a.Hash); err != nil {
				return err
			}
		}
		if result.Next == "" {
			next = nil
			break
		}
		if result.Next == cursor {
			return errors.New("frame admission cursor did not advance")
		}
		cursor = result.Next
		value := cursor
		next = &value
	}
	if err = c.Store.Status(ctx, c.Scope, boot, "poll", "ok", next); err != nil {
		return err
	}
	// Recheck archived/restarted roots too, in a bounded rotating window. The oldest
	// check is selected first so old states cannot starve behind busy new traffic.
	limit := c.RefreshLimit
	if limit <= 0 {
		limit = 10
	}
	rows, err := c.Store.Pool.Query(ctx, `SELECT boot_id,tx_hash FROM frame_transactions WHERE network=$1 AND mode=$2 AND node_id=$3 ORDER BY updated_at ASC LIMIT $4`, c.Scope.Network, c.Scope.Mode, c.Scope.Node, limit)
	if err != nil {
		return err
	}
	type key struct{ boot, hash string }
	keys := []key{}
	for rows.Next() {
		var k key
		if err = rows.Scan(&k.boot, &k.hash); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, k)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, k := range keys {
		p, raw := c.receipt(ctx, k.hash)
		if _, err = c.Store.Receipt(ctx, c.Scope, k.boot, k.hash, p, raw); err != nil {
			return err
		}
	}
	return nil
}
func (c *Collector) Fetch(ctx context.Context, boot, hash string) error {
	if !ingest.ValidRoot(hash) {
		return errors.New("invalid frame transaction hash")
	}
	hash = strings.ToLower(hash)
	var detail Detail
	r, err := c.Node.Call(ctx, "skandha_explorer_getTransaction", []any{hash}, &detail)
	r.Entity = hash
	if err != nil {
		if saveErr := c.Store.Raw(ctx, c.Scope, boot, r); saveErr != nil {
			return saveErr
		}
		var re *RPCError
		if errors.As(err, &re) && re.Code == -32600 {
			return nil
		}
		return err
	}
	if !strings.EqualFold(detail.Hash, hash) {
		return errors.New("frame lookup returned another transaction")
	}
	if _, err = c.Store.Detail(ctx, c.Scope, boot, detail, r); err != nil {
		return err
	}
	proof, records := c.receipt(ctx, hash)
	_, err = c.Store.Receipt(ctx, c.Scope, boot, hash, proof, records)
	return err
}
func (c *Collector) receipt(ctx context.Context, hash string) (Proof, []Raw) {
	proof := Proof{CheckedAt: time.Now().UTC(), Coverage: []string{}}
	records := []Raw{}
	if client, ok := c.Execution.(*Client); ok {
		u, _ := url.Parse(client.URL)
		proof.Origin = u.Scheme + "://" + u.Host
	}
	var receipt *Receipt
	r, err := c.Execution.Call(ctx, "eth_getTransactionReceipt", []any{hash}, &receipt)
	r.Entity = hash
	records = append(records, r)
	if err != nil {
		proof.Coverage = append(proof.Coverage, "execution_receipt_query_failed")
		return proof, records
	}
	proof.Receipt = receipt
	if receipt == nil {
		proof.Coverage = append(proof.Coverage, "execution_receipt_unavailable")
		return proof, records
	}
	n, numberErr := quantity(receipt.BlockNumber)
	_ = n
	proof.IdentityMatched = strings.EqualFold(receipt.Hash, hash) && ingest.ValidRoot(receipt.BlockHash) && numberErr == nil && receipt.Type == "0x6" && (receipt.Status == "0x0" || receipt.Status == "0x1")
	if !proof.IdentityMatched {
		return proof, records
	}
	var block *struct {
		Hash   string `json:"hash"`
		Number string `json:"number"`
	}
	r, err = c.Execution.Call(ctx, "eth_getBlockByNumber", []any{receipt.BlockNumber, false}, &block)
	r.Entity = hash
	records = append(records, r)
	if err != nil || block == nil {
		proof.Coverage = append(proof.Coverage, "canonical_block_unavailable")
	} else {
		blockNumber, e := quantity(block.Number)
		if e != nil || blockNumber != n || !ingest.ValidRoot(block.Hash) {
			proof.IdentityMatched = false
			proof.Coverage = append(proof.Coverage, "canonical_block_identity_mismatch")
		} else {
			proof.Canonical = truth(strings.EqualFold(block.Hash, receipt.BlockHash))
		}
	}
	// Supplemental per-frame receipt is retained with explicit consistency coverage.
	var frame json.RawMessage
	r, err = c.Node.Call(ctx, "eth_getFrameTransactionReceipt", []any{hash}, &frame)
	r.Entity = hash
	records = append(records, r)
	if err != nil || len(frame) == 0 || string(frame) == "null" {
		proof.Coverage = append(proof.Coverage, "supplemental_frame_receipt_unavailable")
	} else {
		proof.FrameReceipt = frame
		var f struct {
			Block  string `json:"blockNumber"`
			Status string `json:"status"`
		}
		if json.Unmarshal(frame, &f) != nil {
			proof.Coverage = append(proof.Coverage, "supplemental_frame_receipt_invalid")
		} else {
			number, e := quantity(f.Block)
			if e != nil || number != n || (f.Status == "success") != (receipt.Status == "0x1") {
				proof.Coverage = append(proof.Coverage, "supplemental_frame_receipt_conflict")
			}
		}
	}
	proof.CheckedAt = time.Now().UTC()
	return proof, records
}

func (c *Collector) SyncHash(ctx context.Context, hash string) error {
	n, err := c.verify(ctx)
	if err != nil {
		return err
	}
	return c.Fetch(ctx, n.Info.Boot, hash)
}
