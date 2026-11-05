package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"rooted/internal/domain"
)

var ErrNotFound = errors.New("upstream resource not found")

type Beacon interface {
	Get(context.Context, string, string) (domain.RawRecord, error)
}
type Execution interface {
	RPC(context.Context, string, []any) (domain.RawRecord, error)
}

type Client struct {
	base string
	http *http.Client
}

func New(base string, timeout time.Duration) *Client {
	return NewWithHTTPClient(base, &http.Client{Timeout: timeout})
}

// NewWithHTTPClient supports explicit transport injection without changing parsing
// or evidence semantics. The caller owns the non-nil client's timeout policy.
func NewWithHTTPClient(base string, client *http.Client) *Client {
	return &Client{strings.TrimRight(base, "/"), client}
}

func (c *Client) Get(ctx context.Context, path, kind string) (domain.RawRecord, error) {
	u, err := url.Parse(c.base)
	if err != nil {
		return domain.RawRecord{}, errors.New("invalid endpoint")
	}
	u.Path = strings.TrimRight(u.Path, "/") + path
	return c.request(ctx, http.MethodGet, u.String(), nil, kind)
}

func (c *Client) RPC(ctx context.Context, method string, params []any) (domain.RawRecord, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return domain.RawRecord{}, err
	}
	r, err := c.request(ctx, http.MethodPost, c.base, body, method)
	if err != nil {
		return r, err
	}
	var envelope struct {
		Error *struct {
			Code int `json:"code"`
		} `json:"error"`
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(r.Body, &envelope); err != nil {
		return r, errors.New("invalid RPC JSON")
	}
	if envelope.Error != nil {
		return r, fmt.Errorf("RPC %s failed (code %d)", method, envelope.Error.Code)
	}
	if len(envelope.Result) == 0 {
		return r, errors.New("RPC response has no result")
	}
	return r, nil
}

func (c *Client) request(ctx context.Context, method, endpoint string, body []byte, kind string) (domain.RawRecord, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return domain.RawRecord{}, errors.New("invalid upstream request")
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return domain.RawRecord{}, ctx.Err()
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return domain.RawRecord{}, context.DeadlineExceeded
		}
		return domain.RawRecord{}, errors.New("upstream connection failed or timed out")
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return domain.RawRecord{}, ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return domain.RawRecord{}, fmt.Errorf("upstream HTTP status %d", resp.StatusCode)
	}
	const maximum = 32 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maximum+1))
	if err != nil {
		if ctx.Err() != nil {
			return domain.RawRecord{}, ctx.Err()
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return domain.RawRecord{}, context.DeadlineExceeded
		}
		return domain.RawRecord{}, errors.New("failed reading upstream response")
	}
	if len(data) > maximum {
		return domain.RawRecord{}, errors.New("upstream response exceeds 32 MiB")
	}
	if !json.Valid(data) {
		return domain.RawRecord{}, errors.New("upstream returned invalid JSON")
	}
	u, _ := url.Parse(endpoint)
	return domain.RawRecord{Source: domain.Source{Kind: kind, Origin: u.Scheme + "://" + u.Host, FetchedAt: time.Now().UTC()}, Body: data}, nil
}
