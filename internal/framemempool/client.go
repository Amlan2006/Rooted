package framemempool

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"rooted/internal/ingest"
	"strings"
	"time"
)

type RPC interface {
	Call(context.Context, string, []any, any) (Raw, error)
}
type Client struct {
	URL  string
	HTTP *http.Client
}

func NewClient(url string, timeout time.Duration) *Client {
	return &Client{URL: url, HTTP: &http.Client{Timeout: timeout}}
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string { return fmt.Sprintf("frame RPC error %d", e.Code) }
func (c *Client) Call(ctx context.Context, method string, params []any, out any) (Raw, error) {
	request, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return Raw{}, errors.New("invalid frame RPC parameters")
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.URL, bytes.NewReader(request))
	if err != nil {
		return Raw{}, errors.New("invalid frame RPC request")
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return Raw{}, ctx.Err()
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return Raw{}, context.DeadlineExceeded
		}
		return Raw{}, errors.New("frame RPC connection failed or timed out")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, (16<<20)+1))
	if err != nil || len(body) > 16<<20 {
		return Raw{}, errors.New("frame RPC response read failed or exceeds limit")
	}
	if response.StatusCode != 200 || !json.Valid(body) {
		return Raw{}, fmt.Errorf("frame RPC HTTP status %d or invalid JSON", response.StatusCode)
	}
	raw := Raw{Method: method, Body: body, At: time.Now().UTC()}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *RPCError       `json:"error"`
	}
	if err = json.Unmarshal(body, &envelope); err != nil {
		return raw, err
	}
	if envelope.Error != nil {
		return raw, envelope.Error
	}
	if len(envelope.Result) == 0 {
		return raw, errors.New("missing frame RPC result")
	}
	if out != nil {
		if err = json.Unmarshal(envelope.Result, out); err != nil {
			return raw, errors.New("invalid frame RPC result schema")
		}
	}
	return raw, nil
}
func Verify(ctx context.Context, node, execution RPC, chain uint64, genesis string) (Info, []Raw, error) {
	var info Info
	records := []Raw{}
	r, err := node.Call(ctx, "skandha_explorer_info", []any{}, &info)
	records = append(records, r)
	if err != nil {
		return info, records, err
	}
	if info.Protocol != 1 || info.ChainID != chain || info.Boot == "" || info.Latest < 0 || info.Oldest < 0 || info.Oldest > info.Latest || info.Capacity <= 0 {
		return info, records, errors.New("unsupported or inconsistent frame node identity")
	}
	var chainHex string
	r, err = execution.Call(ctx, "eth_chainId", []any{}, &chainHex)
	records = append(records, r)
	if err != nil {
		return info, records, err
	}
	number, err := quantity(chainHex)
	if err != nil || number != chain {
		return info, records, errors.New("frame execution chain mismatch")
	}
	var block struct {
		Hash string `json:"hash"`
	}
	r, err = execution.Call(ctx, "eth_getBlockByNumber", []any{"0x0", false}, &block)
	records = append(records, r)
	if err != nil {
		return info, records, err
	}
	if !ingest.ValidRoot(genesis) || !strings.EqualFold(block.Hash, genesis) {
		return info, records, errors.New("frame execution genesis mismatch")
	}
	return info, records, nil
}
