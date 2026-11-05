package framemempool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeRPC struct {
	call func(string, []any, any) (Raw, error)
}

func (f fakeRPC) Call(_ context.Context, m string, p []any, v any) (Raw, error) {
	return f.call(m, p, v)
}
func respond(method string, value any, out any) (Raw, error) {
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "result": value})
	if out != nil {
		r, _ := json.Marshal(value)
		if err := json.Unmarshal(r, out); err != nil {
			return Raw{}, err
		}
	}
	return Raw{Method: method, Body: b, At: time.Now().UTC()}, nil
}
func testRPC(info Info) fakeRPC {
	return fakeRPC{call: func(m string, p []any, v any) (Raw, error) {
		switch m {
		case "skandha_explorer_info":
			return respond(m, info, v)
		case "eth_chainId":
			return respond(m, "0x539", v)
		case "eth_getBlockByNumber":
			return respond(m, map[string]any{"hash": testHash, "number": p[0]}, v)
		case "skandha_explorer_listAdmissions":
			return respond(m, Page{Items: []Admission{}}, v)
		case "eth_getTransactionReceipt":
			return respond(m, nil, v)
		}
		return Raw{}, fmt.Errorf("unexpected %s", m)
	}}
}
func TestVerifyAndReceiptMatching(t *testing.T) {
	client := testRPC(testInfo())
	if _, _, err := Verify(context.Background(), client, client, 1337, testHash); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Verify(context.Background(), client, client, 1, testHash); err == nil {
		t.Fatal("wrong chain accepted")
	}
	if _, _, err := Verify(context.Background(), client, client, 1337, "0x"+strings.Repeat("b", 64)); err == nil {
		t.Fatal("wrong genesis accepted")
	}
	c := Collector{Node: client, Execution: fakeRPC{call: func(m string, p []any, v any) (Raw, error) {
		switch m {
		case "eth_getTransactionReceipt":
			return respond(m, Receipt{Hash: testHash, BlockHash: testHash, BlockNumber: "0x1", Status: "0x1", Type: "0x6"}, v)
		case "eth_getBlockByNumber":
			return respond(m, map[string]any{"hash": testHash, "number": "0x1"}, v)
		}
		return Raw{}, errors.New("unavailable")
	}}}
	p, _ := c.receipt(context.Background(), testHash)
	if !p.IdentityMatched || p.Canonical == nil || !*p.Canonical || !contains(p.Coverage, "supplemental_frame_receipt_unavailable") {
		t.Fatalf("bad proof %+v", p)
	}
	p, _ = c.receipt(context.Background(), "0x"+strings.Repeat("c", 64))
	if p.IdentityMatched {
		t.Fatal("wrong receipt hash matched")
	}
}
func TestSubmissionAcknowledgmentIsNotAdmission(t *testing.T) {
	s := testStore(t)
	base := testRPC(testInfo())
	client := fakeRPC{call: func(m string, p []any, v any) (Raw, error) {
		if m == "eth_sendFrameTransaction" {
			return respond(m, testHash, v)
		}
		if m == "skandha_explorer_getTransaction" {
			return Raw{Method: m, At: stamp, Body: json.RawMessage(`{"error":{"code":-32600,"message":"Frame transaction not found"}}`)}, &RPCError{Code: -32600}
		}
		return base.call(m, p, v)
	}}
	c := Collector{Scope: Scope{Network: testScope.Network, Mode: "live", Node: testScope.Node}, Store: s, Node: client, Execution: base, ChainID: 1337, Genesis: testHash}
	tx := json.RawMessage(`{"chainId":"0x539","frames":[{}],"signatures":[{}]}`)
	result, err := c.Submit(context.Background(), tx, testHash)
	if err != nil || result.Status != "submission_acknowledged" {
		t.Fatalf("submit %+v %v", result, err)
	}
	states, err := s.States(context.Background(), c.Scope, testHash, 50)
	if err != nil || len(states) != 0 {
		t.Fatal("ack inferred admission")
	}
	attempts, err := s.Submissions(context.Background(), c.Scope, 50)
	if err != nil || len(attempts) != 1 {
		t.Fatal("attempt not persisted")
	}
}
func TestStreamResumeAndReconnect(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	info := testInfo()
	base := testRPC(info)
	var since int64 = -1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		read, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		var request struct {
			Params []json.RawMessage `json:"params"`
		}
		if err = wsjson.Read(read, conn, &request); err != nil {
			return
		}
		_ = json.Unmarshal(request.Params[1], &since)
		_ = wsjson.Write(read, conn, map[string]any{"id": 1, "result": "subscription"})
		_ = wsjson.Write(read, conn, map[string]any{})
		for i := since + 1; i <= 2; i++ {
			_ = wsjson.Write(read, conn, map[string]any{"method": "skandha_subscription", "params": map[string]any{"subscription": "subscription", "result": Event{Seq: i, Hash: testHash, At: stamp.UnixMilli() + i, Kind: "admitted"}}})
		}
		_ = conn.Close(websocket.StatusNormalClosure, "done")
	}))
	defer server.Close()
	c := Collector{Scope: testScope, Store: s, Node: base, Execution: base, ChainID: 1337, Genesis: testHash, WSURL: strings.Replace(server.URL, "http", "ws", 1)}
	if err := c.streamOnce(ctx); err == nil {
		t.Fatal("closed stream did not return")
	}
	if since != 0 {
		t.Fatalf("first resume=%d", since)
	}
	if err := c.streamOnce(ctx); err == nil {
		t.Fatal("closed stream did not return")
	}
	if since != 2 {
		t.Fatalf("did not persist resume point %d", since)
	}
	var count int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM frame_events").Scan(&count); err != nil || count != 2 {
		t.Fatal("stream dedupe failed")
	}
}
