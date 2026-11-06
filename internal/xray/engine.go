package xray

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"rooted/internal/bal"
	"rooted/internal/ingest"
	"rooted/internal/profiler"
	"rooted/internal/remote"
	"rooted/internal/uniswap"
)

// ErrStorage marks database failures so the API can tell them apart from unavailable inputs.
var ErrStorage = errors.New("X-ray storage failed")

type Engine struct {
	Profiler  *profiler.Collector
	Profiles  *profiler.Store
	Store     *Store
	Execution remote.Execution
	Beacon    remote.Beacon
}

func stored(err error) error { return fmt.Errorf("%w: %v", ErrStorage, err) }

// Block reuses the newest saved profile of the block, else captures, measures and saves one.
func (e *Engine) Block(ctx context.Context, hash string, source string) (Report, error) {
	hash = strings.ToLower(hash)
	if !ingest.ValidRoot(hash) {
		return Report{}, errors.New("provide an immutable block hash")
	}
	id, err := e.Store.LatestProfile(ctx, hash)
	if err != nil {
		return Report{}, stored(err)
	}
	var capture []byte
	var metrics json.RawMessage
	if id != "" {
		reports, err := e.Profiles.List(ctx, id)
		if err != nil || len(reports) != 1 {
			return Report{}, stored(errors.New("saved profile unavailable"))
		}
		if capture, err = e.Profiles.Capture(ctx, id); err != nil {
			return Report{}, stored(err)
		}
		metrics, source = reports[0].Metrics, "profile"
	} else {
		report, raw, err := e.Profiler.Capture(ctx, hash)
		if err != nil {
			return Report{}, err
		}
		if err = e.Profiles.Correlate(ctx, &report); err == nil {
			err = e.Profiles.Save(ctx, report, raw)
		}
		if err != nil {
			return Report{}, stored(err)
		}
		id, capture, metrics = report.ID, raw, report.Metrics
	}
	return e.finish(ctx, capture, metrics, nil, source, id, true)
}

// FromCapture measures a saved capture (optionally gzip) offline; envelope may be nil to fetch it from the Beacon node.
func (e *Engine) FromCapture(ctx context.Context, capture, envelope []byte) (Report, error) {
	if len(capture) > 1 && capture[0] == 0x1f && capture[1] == 0x8b {
		reader, err := gzip.NewReader(bytes.NewReader(capture))
		if err != nil {
			return Report{}, errors.New("invalid gzip capture")
		}
		defer reader.Close()
		if capture, err = io.ReadAll(io.LimitReader(reader, (32<<20)+1)); err != nil {
			return Report{}, errors.New("invalid gzip capture")
		}
	}
	if len(capture) > 32<<20 {
		return Report{}, errors.New("capture exceeds 32 MiB")
	}
	var c profiler.Capture
	var b rawBlock
	if json.Unmarshal(capture, &c) != nil || json.Unmarshal(c.Block, &b) != nil {
		return Report{}, errors.New("capture block is missing or malformed")
	}
	report, input, err := e.Profiler.Measure(ctx, profiler.Report{CaptureMode: "recorded_capture", InputCapturedAt: time.Now().UTC(), BlockHash: strings.ToLower(b.Hash), BlockNumber: b.Number}, capture)
	if err != nil {
		return Report{}, err
	}
	return e.finish(ctx, input, report.Metrics, envelope, "capture", "", false)
}

// Follow computes head-2 every 12 s while the replay gate is free; busy ticks are skipped, never queued.
func (e *Engine) Follow(ctx context.Context, gate chan struct{}, logger *slog.Logger) {
	ticker := time.NewTicker(12 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case gate <- struct{}{}:
			r, err := e.followOnce(ctx)
			<-gate
			if err != nil && ctx.Err() == nil {
				logger.Warn("xray follow skipped block", "error", err.Error())
			} else if r != nil {
				logger.Info("xray stored", "block", r.Block.Number, "transactions", r.Block.TransactionCount, "gas_weighted", r.Ceilings.Gas.Value, "validator_bal_time", r.Ceilings.Validator.Value, "builder_dag_time", r.Ceilings.Builder.Value)
			}
		default:
			logger.Warn("xray follow skipped tick; a native replay is running")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (e *Engine) followOnce(parent context.Context) (*Report, error) {
	ctx, cancel := context.WithTimeout(parent, 85*time.Second)
	defer cancel()
	var head string
	if err := e.call(ctx, "eth_blockNumber", []any{}, &head); err != nil {
		return nil, err
	}
	number, err := bal.Number(head)
	if err != nil || number < 2 {
		return nil, errors.New("invalid execution head")
	}
	var block struct {
		Hash string `json:"hash"`
	}
	if err := e.call(ctx, "eth_getBlockByNumber", []any{fmt.Sprintf("0x%x", number-2), false}, &block); err != nil {
		return nil, err
	}
	hash := strings.ToLower(block.Hash)
	if !ingest.ValidRoot(hash) {
		return nil, errors.New("invalid head-2 block hash")
	}
	if has, err := e.Store.Has(ctx, hash); err != nil || has {
		return nil, err
	}
	report, capture, err := e.Profiler.Capture(ctx, hash)
	if err != nil {
		return nil, fmt.Errorf("block %d: %w", number-2, err)
	}
	r, err := e.finish(ctx, capture, report.Metrics, nil, "follow", "", true)
	if err != nil {
		return nil, fmt.Errorf("block %d: %w", number-2, err)
	}
	return &r, nil
}

func (e *Engine) call(ctx context.Context, method string, params []any, out any) error {
	record, err := e.Execution.RPC(ctx, method, params)
	if err != nil {
		return fmt.Errorf("%s unavailable: %w", method, err)
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
	}
	if json.Unmarshal(record.Body, &envelope) != nil || json.Unmarshal(envelope.Result, out) != nil {
		return fmt.Errorf("%s returned an unusable result", method)
	}
	return nil
}

// finish attaches the BAL, Uniswap context and ePBS state to a measured capture, computes and stores the report.
func (e *Engine) finish(ctx context.Context, raw []byte, metrics json.RawMessage, envelope []byte, source, profileID string, verify bool) (Report, error) {
	var capture profiler.Capture
	var b rawBlock
	var receipts []struct {
		Logs []uniswap.Log `json:"logs"`
	}
	if json.Unmarshal(raw, &capture) != nil || json.Unmarshal(capture.Block, &b) != nil || json.Unmarshal(capture.Receipts, &receipts) != nil {
		return Report{}, errors.New("capture is malformed")
	}
	number, err := bal.Number(b.Number)
	if err != nil || b.Slot == nil {
		return Report{}, errors.New("block has no number or slotNumber; the payload envelope cannot be located")
	}
	slot, err := bal.Number(*b.Slot)
	if err != nil {
		return Report{}, errors.New("invalid block slotNumber")
	}
	var native bal.Native
	var env Envelope
	if envelope != nil {
		native, env, err = parseEnvelope(envelope, slot, b.Hash, number, len(b.Transactions), b.BALHash)
	} else {
		native, env, err = FetchEnvelope(ctx, e.Beacon, slot, b.Hash, number, len(b.Transactions), b.BALHash)
	}
	if err != nil {
		return Report{}, err
	}
	logs := []uniswap.Log{}
	for _, r := range receipts {
		logs = append(logs, r.Logs...)
	}
	labels := uniswap.ContextFromLogs(logs)
	if verify {
		verifyPools(ctx, e.Execution, strings.ToLower(b.Hash), &labels)
	}
	epbs, err := e.Store.EPBS(ctx, strings.ToLower(b.Hash))
	if err != nil {
		return Report{}, stored(err)
	}
	r, err := Compute(Inputs{Capture: capture, Native: native, Metrics: metrics, Envelope: &env, EPBS: epbs, Uniswap: labels, Source: source, ProfileID: profileID, Now: time.Now()})
	if err != nil {
		return Report{}, err
	}
	if err = e.Store.Save(ctx, r); err != nil {
		return Report{}, stored(err)
	}
	return r, nil
}

// verifyPools is best effort (VerifyV3Pools caps it at 8 pools), bounded to 10 s and the block's state.
func verifyPools(parent context.Context, rpc remote.Execution, hash string, c *uniswap.BlockContext) {
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	uniswap.VerifyV3Pools(ctx, func(ctx context.Context, to, data string) (string, error) {
		record, err := rpc.RPC(ctx, "eth_call", []any{map[string]string{"to": to, "data": data}, map[string]string{"blockHash": hash}})
		if err != nil {
			return "", err
		}
		var envelope struct {
			Result string `json:"result"`
		}
		if json.Unmarshal(record.Body, &envelope) != nil {
			return "", errors.New("invalid eth_call result")
		}
		return envelope.Result, nil
	}, c)
}
