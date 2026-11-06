// Package profiler captures bound transaction prestates for an isolated native replay.
package profiler

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"rooted/internal/ingest"
	"rooted/internal/remote"
	"strconv"
	"strings"
	"time"
)

type Collector struct {
	RPC                                        remote.Execution
	Endpoint, Binary, AnchorNumber, AnchorHash string
	Transport                                  http.RoundTripper
}
type Report struct {
	CaptureMode     string            `json:"capture_mode"`
	InputCapturedAt time.Time         `json:"input_captured_at"`
	ID              string            `json:"id"`
	Schema          string            `json:"schema"`
	Network         string            `json:"network"`
	Mode            string            `json:"mode"`
	BlockHash       string            `json:"block_hash"`
	BlockNumber     string            `json:"block_number"`
	CapturedAt      time.Time         `json:"captured_at"`
	SourceClient    string            `json:"source_client"`
	CaptureDigest   string            `json:"capture_digest"`
	Metrics         json.RawMessage   `json:"metrics"`
	Coverage        []string          `json:"coverage"`
	Analysis        []string          `json:"analysis_ids"`
	Payloads        []json.RawMessage `json:"payload_observations"`
}
type Capture struct {
	Block     json.RawMessage   `json:"block"`
	Traces    json.RawMessage   `json:"traces"`
	Receipts  json.RawMessage   `json:"receipts"`
	Ancestors []json.RawMessage `json:"ancestors"`
}

func (c *Collector) rpc(ctx context.Context, method string, params []any, out any) error {
	r, err := c.RPC.RPC(ctx, method, params)
	if err != nil {
		var response struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(r.Body, &response) == nil && (strings.Contains(strings.ToLower(response.Error.Message), "historical state") || strings.Contains(strings.ToLower(response.Error.Message), "pruned")) {
			return errors.New("historical execution state is unavailable; choose a newer block or rerun a saved capture")
		}
		return fmt.Errorf("%s unavailable", method)
	}
	var env struct {
		Result json.RawMessage `json:"result"`
	}
	if json.Unmarshal(r.Body, &env) != nil || len(env.Result) == 0 || string(env.Result) == "null" {
		return fmt.Errorf("%s returned no usable result", method)
	}
	if json.Unmarshal(env.Result, out) != nil {
		return fmt.Errorf("%s result schema unavailable", method)
	}
	return nil
}
func (c *Collector) Capture(ctx context.Context, hash string) (Report, []byte, error) {
	var report Report
	if !ingest.ValidRoot(hash) {
		return report, nil, errors.New("provide an immutable block hash")
	}
	if c.Binary == "" {
		return report, nil, errors.New("native replay runner is not configured")
	}
	var chain, version string
	if c.rpc(ctx, "eth_chainId", []any{}, &chain) != nil || chain != "0xaa36a7" {
		return report, nil, errors.New("profiler requires verified Sepolia execution RPC")
	}
	var anchor struct {
		Hash   string `json:"hash"`
		Number string `json:"number"`
	}
	if c.rpc(ctx, "eth_getBlockByNumber", []any{c.AnchorNumber, false}, &anchor) != nil || !strings.EqualFold(anchor.Hash, c.AnchorHash) || anchor.Number != c.AnchorNumber {
		return report, nil, errors.New("profiler network anchor mismatch or unavailable")
	}
	if c.rpc(ctx, "web3_clientVersion", []any{}, &version) != nil || !strings.HasPrefix(version, "Geth/v1.17.10-") {
		return report, nil, errors.New("this replay adapter requires Geth 1.17.10; other versions remain unsupported")
	}
	var capture Capture
	if err := c.rpc(ctx, "eth_getBlockByHash", []any{hash, true}, &capture.Block); err != nil {
		return report, nil, err
	}
	var block struct {
		Hash         string            `json:"hash"`
		Number       string            `json:"number"`
		Transactions []json.RawMessage `json:"transactions"`
	}
	if json.Unmarshal(capture.Block, &block) != nil || !strings.EqualFold(block.Hash, hash) || len(block.Transactions) == 0 || len(block.Transactions) > 512 {
		return report, nil, errors.New("select a nonempty block containing at most 512 transactions")
	}
	n, err := strconv.ParseUint(strings.TrimPrefix(block.Number, "0x"), 16, 64)
	if err != nil {
		return report, nil, errors.New("invalid block number")
	}
	if err := c.rpc(ctx, "eth_getBlockReceipts", []any{hash}, &capture.Receipts); err != nil {
		return report, nil, err
	}
	if err := c.rpc(ctx, "debug_traceBlockByHash", []any{hash, map[string]any{"tracer": "prestateTracer", "timeout": "10s"}}, &capture.Traces); err != nil {
		return report, nil, err
	}
	// One bounded batch retrieves the full BLOCKHASH environment, not 256 round trips.
	capture.Ancestors, err = c.ancestors(ctx, n)
	if err != nil {
		return report, nil, err
	}
	var final struct {
		Hash string `json:"hash"`
	}
	if c.rpc(ctx, "eth_getBlockByNumber", []any{block.Number, false}, &final) != nil || !strings.EqualFold(final.Hash, hash) {
		return report, nil, errors.New("block changed during capture; retry an immutable canonical block")
	}
	input, err := json.Marshal(capture)
	if err != nil {
		return report, nil, err
	}
	if len(input) > 32<<20 {
		return report, nil, errors.New("capture exceeds 32 MiB profiling limit")
	}
	return c.Measure(ctx, Report{CaptureMode: "live_rpc_capture", InputCapturedAt: time.Now().UTC(), SourceClient: version, BlockHash: strings.ToLower(hash), BlockNumber: block.Number}, input)
}

// Measure reuses immutable captured state without requiring historical node access.
func (c *Collector) Measure(ctx context.Context, metadata Report, input []byte) (Report, []byte, error) {
	var report Report
	if len(input) > 32<<20 {
		return report, nil, errors.New("replay input exceeds limit")
	}
	var capture Capture
	var block struct {
		Hash         string            `json:"hash"`
		Number       string            `json:"number"`
		Transactions []json.RawMessage `json:"transactions"`
	}
	if !ingest.ValidRoot(metadata.BlockHash) || json.Unmarshal(input, &capture) != nil || json.Unmarshal(capture.Block, &block) != nil || !strings.EqualFold(block.Hash, metadata.BlockHash) || block.Number != metadata.BlockNumber || len(block.Transactions) == 0 || len(block.Transactions) > 512 {
		return report, nil, errors.New("stored capture identity mismatch")
	}
	digest := sha256.Sum256(input)
	if metadata.CaptureDigest != "" && metadata.CaptureDigest != hex.EncodeToString(digest[:]) {
		return report, nil, errors.New("stored capture digest mismatch")
	}
	if _, err := exec.LookPath(c.Binary); err != nil {
		return report, nil, errors.New("native replay runner unavailable; build workloads/profiler and configure ROOTED_REPLAY_BINARY")
	}
	command := exec.CommandContext(ctx, c.Binary)
	command.Env = []string{"PATH=" + os.Getenv("PATH")}
	command.Stdin = bytes.NewReader(input)
	var stderr limitedBuffer
	command.Stderr = &stderr
	stdout := boundedOutput{limit: 8 << 20}
	command.Stdout = &stdout
	err := command.Run()
	if stdout.exceeded {
		return report, nil, errors.New("native output exceeds limit")
	}
	if err != nil {
		if ctx.Err() != nil {
			return report, nil, ctx.Err()
		}
		return report, nil, fmt.Errorf("native replay failed validation: %s", stderr.String())
	}
	result := stdout.Bytes()
	if err := ValidateMetrics(result, metadata.BlockHash, len(block.Transactions)); err != nil {
		return report, nil, err
	}
	id := make([]byte, 32)
	if _, err := rand.Read(id); err != nil {
		return report, nil, err
	}
	report = Report{CaptureMode: metadata.CaptureMode, InputCapturedAt: metadata.InputCapturedAt, ID: "0x" + hex.EncodeToString(id), Schema: "rooted-execution-profile-v1", Network: "sepolia", Mode: "replay", BlockHash: metadata.BlockHash, BlockNumber: metadata.BlockNumber, CapturedAt: time.Now().UTC(), SourceClient: metadata.SourceClient, CaptureDigest: hex.EncodeToString(digest[:]), Metrics: result, Analysis: []string{}, Payloads: []json.RawMessage{}, Coverage: []string{"native_in_memory_trace_seeded_replay", "all_block_transactions_in_original_order", "gas_status_and_logs_match_receipts", "state_method_intervals_are_nested_in_apply_time", "warm_cache_sequential_benchmark", "instrumented_and_control_runs_alternate", "not_full_block_import_or_consensus_validation", "no_full_state_root_verification", "physical_database_io_unknown", "evm_exclusive_time_unknown", "bal_processing_time_unknown", "protocol_deadline_margin_unknown", "no_measured_parallel_speedup"}}
	return report, input, nil
}

type limitedBuffer struct{ buffer bytes.Buffer }

func (b *limitedBuffer) String() string { return b.buffer.String() }

type boundedOutput struct {
	buffer   bytes.Buffer
	limit    int
	exceeded bool
}

func (b *boundedOutput) Len() int      { return b.buffer.Len() }
func (b *boundedOutput) Bytes() []byte { return b.buffer.Bytes() }

func (b *boundedOutput) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		b.exceeded = true
		return 0, errors.New("native output exceeds limit")
	}
	return b.buffer.Write(p)
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if b.buffer.Len() < 1024 {
		keep := 1024 - b.buffer.Len()
		if len(p) > keep {
			p = p[:keep]
		}
		_, _ = b.buffer.Write(p)
	}
	return n, nil
}
func (c *Collector) ancestors(ctx context.Context, number uint64) ([]json.RawMessage, error) {
	count := uint64(256)
	if number < count {
		count = number
	}
	requests := []any{}
	for i := uint64(0); i < count; i++ {
		requests = append(requests, map[string]any{"jsonrpc": "2.0", "id": i, "method": "eth_getBlockByNumber", "params": []any{fmt.Sprintf("0x%x", number-i-1), false}})
	}
	body, _ := json.Marshal(requests)
	req, err := http.NewRequestWithContext(ctx, "POST", c.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("invalid profiling endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: c.Transport, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return nil, errors.New("ancestor batch unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (16<<20)+1))
	if err != nil || response.StatusCode != 200 || len(raw) > 16<<20 {
		return nil, errors.New("ancestor batch failed or exceeded limit")
	}
	var rows []struct {
		ID     uint64          `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if json.Unmarshal(raw, &rows) != nil || len(rows) != int(count) {
		return nil, errors.New("incomplete ancestor environment")
	}
	result := make([]json.RawMessage, count)
	for _, row := range rows {
		if row.ID >= count || result[row.ID] != nil || len(row.Error) > 0 || len(row.Result) == 0 || string(row.Result) == "null" {
			return nil, errors.New("invalid ancestor batch binding")
		}
		result[row.ID] = row.Result
	}
	return result, nil
}
func ValidateMetrics(raw []byte, hash string, transactions int) error {
	var m struct {
		Runner        string `json:"runner"`
		Block         string `json:"block_hash"`
		Transactions  int    `json:"transaction_count"`
		Median        int64  `json:"median_apply_ns"`
		ControlMedian int64  `json:"control_median_ns"`
		Samples       []struct {
			EVM          *int64 `json:"evm_call_ns"`
			EVMState     *int64 `json:"state_inside_evm_ns"`
			Apply        int64  `json:"apply_ns"`
			State        int64  `json:"state_access_ns"`
			Finalize     int64  `json:"finalize_ns"`
			Transactions []struct {
				EVM      *int64 `json:"evm_call_ns"`
				EVMState *int64 `json:"state_inside_evm_ns"`
				Apply    int64  `json:"apply_ns"`
				State    int64  `json:"state_access_ns"`
				Finalize int64  `json:"finalize_ns"`
			} `json:"transactions"`
		} `json:"samples"`
		Control []int64 `json:"control_apply_ns"`
	}
	if json.Unmarshal(raw, &m) != nil || m.Runner != "rooted-native-replay-v1" || !strings.EqualFold(m.Block, hash) || m.Transactions != transactions || m.Median <= 0 || m.ControlMedian <= 0 || len(m.Samples) != 7 || len(m.Control) != 7 {
		return errors.New("native metrics are missing, unsupported, or bound to another payload")
	}
	valid := func(a, st int64, e, es *int64) bool {
		return e != nil && es != nil && *e >= 0 && *es >= 0 && *es <= *e && *es <= st && *e+(st-*es) <= a
	}
	for i, s := range m.Samples {
		if !valid(s.Apply, s.State, s.EVM, s.EVMState) || s.Apply <= 0 || s.State < 0 || s.State > s.Apply || s.Finalize < 0 || m.Control[i] <= 0 || len(s.Transactions) != transactions {
			return errors.New("invalid native timing boundaries")
		}
		var a, st, f, e, es int64
		for _, tx := range s.Transactions {
			if !valid(tx.Apply, tx.State, tx.EVM, tx.EVMState) || tx.Apply <= 0 || tx.State < 0 || tx.State > tx.Apply || tx.Finalize < 0 {
				return errors.New("invalid transaction timer")
			}
			a += tx.Apply
			st += tx.State
			f += tx.Finalize
			e += *tx.EVM
			es += *tx.EVMState
		}
		if a != s.Apply || st != s.State || f != s.Finalize || e != *s.EVM || es != *s.EVMState {
			return errors.New("native timing totals do not reconcile")
		}
	}
	return nil
}
