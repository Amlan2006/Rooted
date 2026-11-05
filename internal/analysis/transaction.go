package analysis

import (
	"context"
	"errors"
	"rooted/internal/ingest"
	"strings"
)

var ErrTransactionNotFound = errors.New("transaction not found")
var ErrTransactionPending = errors.New("transaction is pending")

// ResolveTransactionBlock locates a mined transaction; Fetch subsequently checks
// the configured network, block membership, receipt, and trace-provider binding.
func (c *Collector) ResolveTransactionBlock(ctx context.Context, hash string) (string, error) {
	if !ingest.ValidRoot(hash) {
		return "", errors.New("transaction hash must be 32 bytes")
	}
	hash = strings.ToLower(hash)
	var tx *Transaction
	f := &fetch{}
	if err := f.rpc(ctx, c.Execution, "eth_getTransactionByHash", "resolve:"+hash, []any{hash}, &tx); err != nil {
		return "", err
	}
	if tx == nil {
		return "", ErrTransactionNotFound
	}
	if !strings.EqualFold(tx.Hash, hash) {
		return "", errors.New("transaction identity mismatch")
	}
	if tx.BlockHash == "" {
		return "", ErrTransactionPending
	}
	if !ingest.ValidRoot(tx.BlockHash) {
		return "", errors.New("invalid transaction block hash")
	}
	return strings.ToLower(tx.BlockHash), nil
}
