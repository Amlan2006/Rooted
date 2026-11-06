// Package providers compares independently observed, immutable Sepolia evidence.
package providers

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
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"rooted/internal/bal"
)

var hashPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)

func ValidHash(s string) bool { return hashPattern.MatchString(s) }

type Endpoint struct{ ID, Execution, Beacon string }
type Collector struct {
	Providers                             [2]Endpoint
	AnchorNumber, AnchorHash, GenesisRoot string
	Timeout                               time.Duration
	Transport                             http.RoundTripper
}
type Check struct {
	Method     string    `json:"method"`
	Identity   string    `json:"identity"`
	Status     string    `json:"status"`
	ObservedAt time.Time `json:"observed_at"`
	HTTPStatus int       `json:"http_status,omitempty"`
	RPCCode    *int      `json:"rpc_code,omitempty"`
	Digest     string    `json:"response_digest,omitempty"`
	Data       any       `json:"data,omitempty"`
}
type Header struct {
	Hash             string   `json:"hash"`
	Number           string   `json:"number"`
	Parent           string   `json:"parentHash"`
	State            string   `json:"stateRoot"`
	TransactionsRoot string   `json:"transactionsRoot"`
	ReceiptsRoot     string   `json:"receiptsRoot"`
	BALHash          string   `json:"blockAccessListHash,omitempty"`
	Slot             string   `json:"slotNumber,omitempty"`
	Timestamp        string   `json:"timestamp"`
	Transactions     []string `json:"transactions"`
}

func sourceID(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return "unconfigured"
	}
	u.User = nil
	u.RawQuery = ""
	u.Fragment = ""
	sum := sha256.Sum256([]byte(u.String()))
	return "sha256:" + hex.EncodeToString(sum[:])
}

type Observation struct {
	ExecutionSource string  `json:"execution_source_id"`
	BeaconSource    string  `json:"beacon_source_id"`
	Provider        string  `json:"provider"`
	NetworkVerified bool    `json:"network_verified"`
	Header          *Header `json:"header,omitempty"`
	Checks          []Check `json:"checks"`
}
type Finding struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}
type Report struct {
	ID           string         `json:"id"`
	Schema       string         `json:"schema"`
	Network      string         `json:"network"`
	Mode         string         `json:"mode"`
	BlockHash    string         `json:"block_hash"`
	CreatedAt    time.Time      `json:"created_at"`
	Status       string         `json:"status"`
	Observations [2]Observation `json:"observations"`
	Findings     []Finding      `json:"findings"`
}

// request retains a digest of the original response, but only allowlisted data.
// In particular upstream error messages, URLs, credentials, and bodies are never exported.
func (c *Collector) request(ctx context.Context, endpoint, method, identity string, params []any) (Check, json.RawMessage) {
	check := Check{Method: method, Identity: identity, Status: "transport_error", ObservedAt: time.Now().UTC()}
	verb := http.MethodPost
	target := endpoint
	var body io.Reader
	if strings.HasPrefix(method, "/") {
		verb = http.MethodGet
		target = strings.TrimRight(endpoint, "/") + method
	} else {
		encoded, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, verb, target, body)
	if err != nil {
		return check, nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	client := &http.Client{Transport: c.Transport, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		var networkError net.Error
		if ctx.Err() != nil || (errors.As(err, &networkError) && networkError.Timeout()) {
			check.Status = "timeout_or_canceled"
		}
		return check, nil
	}
	defer response.Body.Close()
	check.HTTPStatus = response.StatusCode
	data, err := io.ReadAll(io.LimitReader(response.Body, (16<<20)+1))
	if err != nil {
		return check, nil
	}
	if len(data) > 16<<20 {
		check.Status = "response_too_large"
		return check, nil
	}
	digest := sha256.Sum256(data)
	check.Digest = hex.EncodeToString(digest[:])
	if response.StatusCode != 200 {
		check.Status = "http_error"
		if response.StatusCode == 404 {
			check.Status = "not_found"
		}
		if response.StatusCode == 405 || response.StatusCode == 501 {
			check.Status = "unsupported"
		}
		if response.StatusCode == 429 {
			check.Status = "rate_limited"
		}
		return check, nil
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if !json.Valid(data) {
		check.Status = "malformed_response"
		return check, nil
	}
	if verb == http.MethodGet {
		check.Status = "available"
		return check, data
	}
	if json.Unmarshal(data, &envelope) != nil {
		check.Status = "malformed_response"
		return check, nil
	}
	if envelope.Error != nil {
		code := envelope.Error.Code
		check.RPCCode = &code
		check.Status = "rpc_error"
		if code == -32601 {
			check.Status = "unsupported"
		}
		message := strings.ToLower(envelope.Error.Message)
		if strings.Contains(message, "prun") || strings.Contains(message, "history unavailable") || strings.Contains(message, "historical state") {
			check.Status = "pruning_reported"
		}
		return check, nil
	}
	if len(envelope.Result) == 0 {
		check.Status = "malformed_response"
		return check, nil
	}
	if string(envelope.Result) == "null" {
		check.Status = "not_found"
		return check, nil
	}
	check.Status = "available"
	return check, envelope.Result
}
func validQuantity(s string) bool { _, err := bal.Number(s); return err == nil }
func normalize(h *Header) bool {
	for _, value := range []*string{&h.Hash, &h.Parent, &h.State, &h.TransactionsRoot, &h.ReceiptsRoot, &h.BALHash} {
		if *value != "" && !ValidHash(*value) {
			return false
		}
		*value = strings.ToLower(*value)
	}
	for _, value := range []*string{&h.Number, &h.Timestamp, &h.Slot} {
		if *value == "" {
			continue
		}
		n, err := bal.Number(*value)
		if err != nil {
			return false
		}
		*value = fmt.Sprintf("0x%x", n)
	}
	for i, hash := range h.Transactions {
		if !ValidHash(hash) {
			return false
		}
		h.Transactions[i] = strings.ToLower(hash)
	}
	return true
}
func (c *Collector) Latest(ctx context.Context) (string, error) {
	check, raw := c.request(ctx, c.Providers[0].Execution, "eth_getBlockByNumber", "finalized", []any{"finalized", false})
	var h Header
	if check.Status != "available" || json.Unmarshal(raw, &h) != nil || !ValidHash(h.Hash) {
		return "", fmt.Errorf("configured primary finalized block unavailable")
	}
	return strings.ToLower(h.Hash), nil
}
func (c *Collector) Compare(ctx context.Context, hash string) (Report, error) {
	if !ValidHash(hash) {
		return Report{}, fmt.Errorf("expected an immutable block hash")
	}
	id := make([]byte, 32)
	if _, err := rand.Read(id); err != nil {
		return Report{}, err
	}
	report := Report{ID: "0x" + hex.EncodeToString(id), Schema: "rooted-provider-comparison-v1", Network: "sepolia", Mode: "live", BlockHash: strings.ToLower(hash), CreatedAt: time.Now().UTC(), Findings: []Finding{}}
	var wg sync.WaitGroup
	for i, p := range c.Providers {
		wg.Add(1)
		go func(i int, p Endpoint) { defer wg.Done(); report.Observations[i] = c.observe(ctx, p, report.BlockHash) }(i, p)
	}
	wg.Wait()
	Evaluate(&report)
	return report, nil
}
func (c *Collector) observe(ctx context.Context, p Endpoint, hash string) Observation {
	o := Observation{Provider: p.ID, ExecutionSource: sourceID(p.Execution), BeaconSource: sourceID(p.Beacon), Checks: []Check{}}
	chain, raw := c.request(ctx, p.Execution, "eth_chainId", "sepolia", []any{})
	var chainID string
	if chain.Status == "available" {
		if json.Unmarshal(raw, &chainID) != nil {
			chain.Status = "malformed_response"
		} else if n, e := strconv.ParseUint(strings.TrimPrefix(chainID, "0x"), 16, 64); e != nil || n != 11155111 {
			chain.Status = "network_mismatch"
		} else {
			chain.Data = map[string]string{"chain_id": "11155111"}
		}
	}
	o.Checks = append(o.Checks, chain)
	anchor, aRaw := c.request(ctx, p.Execution, "eth_getBlockByNumber", c.AnchorNumber, []any{c.AnchorNumber, false})
	var a Header
	if anchor.Status == "available" {
		if json.Unmarshal(aRaw, &a) != nil || !ValidHash(a.Hash) || !validQuantity(a.Number) {
			anchor.Status = "malformed_response"
		} else {
			anchor.Data = map[string]string{"number": a.Number, "hash": a.Hash}
			if !strings.EqualFold(a.Hash, c.AnchorHash) || a.Number != c.AnchorNumber {
				anchor.Status = "network_mismatch"
			}
		}
	}
	o.Checks = append(o.Checks, anchor)
	o.NetworkVerified = chain.Status == "available" && anchor.Status == "available"
	if !o.NetworkVerified {
		return o
	}
	block, bRaw := c.request(ctx, p.Execution, "eth_getBlockByHash", hash, []any{hash, false})
	var h Header
	if block.Status == "available" {
		if json.Unmarshal(bRaw, &h) != nil || !ValidHash(h.Hash) || !ValidHash(h.Parent) || !ValidHash(h.State) || !ValidHash(h.ReceiptsRoot) || !ValidHash(h.TransactionsRoot) || h.Number == "" || h.Timestamp == "" || h.Transactions == nil || !normalize(&h) {
			block.Status = "malformed_response"
		} else if !strings.EqualFold(h.Hash, hash) {
			block.Status = "identity_mismatch"
			block.Data = map[string]string{"returned_hash": h.Hash}
		} else {
			block.Data = h
			o.Header = &h
		}
	}
	o.Checks = append(o.Checks, block)
	if o.Header == nil {
		return o
	}
	getter, gRaw := c.request(ctx, p.Execution, "eth_getBlockAccessList", hash, []any{hash})
	if getter.Status == "available" {
		if !ValidHash(h.BALHash) {
			getter.Status = "commitment_unavailable"
		} else {
			decoded, e := bal.DecodeNative(gRaw, len(h.Transactions), h.BALHash)
			if e != nil {
				getter.Status = "invalid_bal_or_commitment_mismatch"
			} else {
				getter.Data = map[string]any{"computed_commitment": decoded.ComputedHash, "commitment_verified": decoded.CommitmentVerified, "accounts": decoded.Accounts}
			}
		}
	}
	o.Checks = append(o.Checks, getter)
	if p.Beacon == "" {
		o.Checks = append(o.Checks, Check{Method: "beacon_envelope", Identity: hash, Status: "not_configured", ObservedAt: time.Now().UTC()})
		return o
	}
	genesis, genRaw := c.request(ctx, p.Beacon, "/eth/v1/beacon/genesis", "sepolia", nil)
	var gen struct {
		Data struct {
			Root string `json:"genesis_validators_root"`
		} `json:"data"`
	}
	if genesis.Status == "available" {
		if json.Unmarshal(genRaw, &gen) != nil || !ValidHash(gen.Data.Root) {
			genesis.Status = "malformed_response"
		} else {
			genesis.Data = map[string]string{"genesis_validators_root": gen.Data.Root}
			if !strings.EqualFold(gen.Data.Root, c.GenesisRoot) {
				genesis.Status = "network_mismatch"
			}
		}
	}
	o.Checks = append(o.Checks, genesis)
	if genesis.Status != "available" {
		return o
	}
	slot, e := bal.Number(h.Slot)
	if e != nil {
		o.Checks = append(o.Checks, Check{Method: "beacon_envelope", Identity: hash, Status: "slot_unavailable", ObservedAt: time.Now().UTC()})
		return o
	}
	path := fmt.Sprintf("/eth/v1/beacon/execution_payload_envelopes/%d", slot)
	envelope, eRaw := c.request(ctx, p.Beacon, path, hash, nil)
	if envelope.Status == "available" {
		var env struct {
			Data struct {
				Message struct {
					Payload struct {
						Hash   string `json:"block_hash"`
						Number string `json:"block_number"`
						Slot   string `json:"slot_number"`
						BAL    string `json:"block_access_list"`
					} `json:"payload"`
				} `json:"message"`
			} `json:"data"`
		}
		number, nErr := bal.Number(h.Number)
		if json.Unmarshal(eRaw, &env) != nil || nErr != nil || !ValidHash(env.Data.Message.Payload.Hash) {
			envelope.Status = "malformed_response"
		} else {
			payload := env.Data.Message.Payload
			if _, err := strconv.ParseUint(payload.Number, 10, 64); err != nil {
				envelope.Status = "malformed_response"
				o.Checks = append(o.Checks, envelope)
				return o
			}
			if _, err := strconv.ParseUint(payload.Slot, 10, 64); err != nil {
				envelope.Status = "malformed_response"
				o.Checks = append(o.Checks, envelope)
				return o
			}
			envelope.Data = map[string]string{"block_hash": payload.Hash, "block_number": payload.Number, "slot_number": payload.Slot}
			if !strings.EqualFold(payload.Hash, hash) || payload.Number != fmt.Sprint(number) || payload.Slot != fmt.Sprint(slot) {
				envelope.Status = "identity_mismatch"
			} else if !ValidHash(h.BALHash) {
				envelope.Status = "commitment_unavailable"
			} else {
				decoded, e := bal.DecodeNativeRLP(payload.BAL, len(h.Transactions), h.BALHash)
				if e != nil {
					envelope.Status = "invalid_bal_or_commitment_mismatch"
				} else {
					envelope.Data = map[string]any{"block_hash": payload.Hash, "block_number": payload.Number, "slot_number": payload.Slot, "computed_commitment": decoded.ComputedHash, "commitment_verified": decoded.CommitmentVerified, "accounts": decoded.Accounts}
				}
			}
		}
	}
	o.Checks = append(o.Checks, envelope)
	return o
}

// Evaluate distinguishes contradictory returned data from incomplete observations.
func Evaluate(r *Report) {
	r.Status = "consistent_observed_data"
	r.Findings = []Finding{}
	incomplete := false
	contradiction := false
	for _, o := range r.Observations {
		if !o.NetworkVerified || o.Header == nil {
			incomplete = true
		}
		for _, check := range o.Checks {
			if check.Status == "identity_mismatch" || check.Status == "invalid_bal_or_commitment_mismatch" {
				contradiction = true
				r.Findings = append(r.Findings, Finding{"returned_evidence_conflict", o.Provider + ": " + check.Method + " returned an identity mismatch or invalid BAL/commitment; neither provider is declared authoritative."})
			}
			if check.Status != "available" {
				incomplete = true
				r.Findings = append(r.Findings, Finding{check.Status, o.Provider + ": " + check.Method + " — " + check.Status + ". This does not establish a consensus failure."})
			}
		}
	}
	a, b := r.Observations[0], r.Observations[1]
	if a.ExecutionSource == b.ExecutionSource {
		incomplete = true
		r.Findings = append(r.Findings, Finding{"same_execution_source", "Both configured execution URLs have the same sanitized source fingerprint; this does not provide an independent cross-check."})
	}
	if a.NetworkVerified && b.NetworkVerified && a.Header != nil && b.Header != nil {
		left, _ := json.Marshal(a.Header)
		right, _ := json.Marshal(b.Header)
		if !bytes.Equal(left, right) {
			contradiction = true
			r.Findings = append(r.Findings, Finding{"block_data_disagreement", "Providers returned different allowlisted block fields for the same requested hash. Inspect both observations; neither is automatically correct."})
		} else {
			r.Findings = append(r.Findings, Finding{"block_data_match", "Both network-verified providers returned matching selected block fields and ordered transaction hashes."})
			hasBAL := func(o Observation) bool {
				for _, check := range o.Checks {
					if check.Status == "available" && (check.Method == "eth_getBlockAccessList" || strings.Contains(check.Method, "/execution_payload_envelopes/")) {
						return true
					}
				}
				return false
			}
			if ValidHash(a.Header.BALHash) && hasBAL(a) && hasBAL(b) {
				r.Findings = append(r.Findings, Finding{"bal_commitments_verified_on_both", "Both providers supplied a decoded native BAL matching the same execution-header commitment, through their available getter or Beacon envelope route."})
			}
		}
	}
	sort.SliceStable(r.Findings, func(i, j int) bool { return r.Findings[i].Code < r.Findings[j].Code })
	if incomplete {
		r.Status = "incomplete_observations"
		if a.NetworkVerified && b.NetworkVerified && a.Header != nil && b.Header != nil {
			r.Status = "matching_block_with_observation_gaps"
		}
	}
	if contradiction {
		r.Status = "disagreement_requires_investigation"
	}
}
