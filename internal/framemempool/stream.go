package framemempool

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"time"
)

func (c *Collector) Stream(ctx context.Context) {
	delay := time.Second
	defer func() {
		finish, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		n, err := c.Store.Node(finish, c.Scope)
		if err == nil {
			_ = c.Store.Status(finish, c.Scope, n.Info.Boot, "stream", "stopped", nil)
		}
	}()
	for ctx.Err() == nil {
		err := c.streamOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		n, readErr := c.Store.Node(ctx, c.Scope)
		if readErr == nil {
			_ = c.Store.Status(ctx, c.Scope, n.Info.Boot, "stream", "unavailable", nil)
		}
		if c.Logger != nil {
			c.Logger.WarnContext(ctx, "frame event stream unavailable; polling continues", "node", c.Scope.Node, "retry_after", delay.String(), "error", err.Error())
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		delay *= 2
		if delay > time.Minute {
			delay = time.Minute
		}
	}
}
func (c *Collector) streamOnce(ctx context.Context) error {
	n, err := c.verify(ctx)
	if err != nil {
		return err
	}
	dialCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	conn, _, err := websocket.Dial(dialCtx, c.WSURL, nil)
	cancel()
	if err != nil {
		return errors.New("frame WebSocket connection failed")
	}
	defer conn.CloseNow()
	conn.SetReadLimit(2 << 20)
	writeCtx, stop := context.WithTimeout(ctx, 10*time.Second)
	err = wsjson.Write(writeCtx, conn, map[string]any{"jsonrpc": "2.0", "id": 1, "method": "skandha_subscribe", "params": []any{"explorerEvents", n.Seq}})
	stop()
	if err != nil {
		return errors.New("frame subscription write failed")
	}
	readCtx, stop := context.WithTimeout(ctx, 15*time.Second)
	var ack struct {
		ID     int    `json:"id"`
		Result string `json:"result"`
	}
	err = wsjson.Read(readCtx, conn, &ack)
	stop()
	if err != nil || ack.ID != 1 || ack.Result == "" {
		return errors.New("frame subscription was not acknowledged")
	}
	// The subscription can race a restart between HTTP metadata and WS connect.
	var check Info
	if _, err = c.Node.Call(ctx, "skandha_explorer_info", []any{}, &check); err != nil || check.Boot != n.Info.Boot || check.ChainID != c.ChainID {
		return errors.New("frame node identity changed while subscribing")
	}
	if err = c.Store.Status(ctx, c.Scope, n.Info.Boot, "stream", "connected", nil); err != nil {
		return err
	}
	streamCtx, end := context.WithCancel(ctx)
	defer end()
	// A reader must remain active for Ping's control responses. Ping bounds silent
	// broken connections without demanding transaction activity on an idle devnet.
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-streamCtx.Done():
				return
			case <-ticker.C:
				pingCtx, done := context.WithTimeout(streamCtx, 5*time.Second)
				err := conn.Ping(pingCtx)
				done()
				if err != nil {
					end()
					return
				}
			}
		}
	}()
	for {
		var wire json.RawMessage
		if err = wsjson.Read(streamCtx, conn, &wire); err != nil {
			return errors.New("frame subscription disconnected")
		}
		event, err := decodeSubscriptionEvent(wire, ack.Result)
		if err != nil {
			return err
		}
		if event == nil {
			continue
		}
		if _, err = c.Store.Event(ctx, c.Scope, n.Info.Boot, *event); err != nil {
			return err
		}
		// Admission polling repairs raw reports independently. Do not block stream
		// receipt processing on remote transaction/receipt fetches.
	}
}

func decodeSubscriptionEvent(wire []byte, subscription string) (*Event, error) {
	// The sidecar's empty post-ack object is neither an event nor receipt evidence.
	if bytes.Equal(bytes.TrimSpace(wire), []byte("{}")) {
		return nil, nil
	}
	var msg struct {
		Method string `json:"method"`
		Params struct {
			Subscription string `json:"subscription"`
			Result       Event  `json:"result"`
		} `json:"params"`
	}
	if json.Unmarshal(wire, &msg) != nil {
		return nil, errors.New("invalid frame subscription JSON")
	}
	if subscription == "" || msg.Method != "skandha_subscription" || msg.Params.Subscription != subscription {
		return nil, errors.New("unexpected frame subscription envelope")
	}
	if err := validateEvent(msg.Params.Result); err != nil {
		return nil, err
	}
	return &msg.Params.Result, nil
}
