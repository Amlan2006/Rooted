package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"rooted/internal/domain"
	"strconv"
	"strings"
)

// VerifyNetwork checks only endpoint identity, without fetching a slot or payload.
// Live subscriptions must not wait for historical polling to finish.
func (c *Collector) VerifyNetwork(ctx context.Context) error {
	_, _, err := c.networkIdentity(ctx)
	return err
}
func (c *Collector) networkIdentity(ctx context.Context) (string, []domain.RawRecord, error) {
	records := []domain.RawRecord{}
	genesis, err := c.Beacon.Get(ctx, "/eth/v1/beacon/genesis", "beacon_genesis")
	if err != nil {
		return "", records, fmt.Errorf("genesis: %w", err)
	}
	records = append(records, genesis)
	var g struct {
		Data struct {
			Root string `json:"genesis_validators_root"`
		} `json:"data"`
	}
	if json.Unmarshal(genesis.Body, &g) != nil || !ValidRoot(g.Data.Root) {
		return "", records, errors.New("malformed beacon genesis")
	}
	if !strings.EqualFold(g.Data.Root, c.GenesisRoot) {
		return "", records, fmt.Errorf("%w: beacon genesis", ErrMismatch)
	}
	chain, err := c.Execution.RPC(ctx, "eth_chainId", []any{})
	if err != nil {
		return "", records, err
	}
	records = append(records, chain)
	var chainID string
	if decodeResult(chain.Body, &chainID) != nil {
		return "", records, errors.New("malformed execution chain ID")
	}
	id, err := parseNumber(chainID)
	if err != nil || strconv.FormatUint(id, 10) != c.ChainID {
		return "", records, fmt.Errorf("%w: execution chain ID", ErrMismatch)
	}
	return strings.ToLower(g.Data.Root), records, nil
}
