package payloadwatch

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"rooted/internal/ingest"
)

type Stream struct {
	VerifyNetwork          func(context.Context) error
	Engine                 *Engine
	URL, Network, SourceID string
	Logger                 *slog.Logger
	Wake                   chan<- uint64
	IdleTimeout            time.Duration
	HTTPClient             *http.Client
}

func sessionID() string { var b [16]byte; _, _ = rand.Read(b[:]); return hex.EncodeToString(b[:]) }

func (s *Stream) Run(ctx context.Context) {
	defer func() {
		finish, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = s.Engine.SetProgress(finish, s.Network, s.SourceID, "stream", "stopped", nil)
	}()
	delay := time.Second
	for ctx.Err() == nil {
		var err error
		status := "unavailable"
		_ = s.Engine.SetProgress(ctx, s.Network, s.SourceID, "stream", "waiting_for_network_verification", nil)
		err = s.verifyNetwork(ctx)
		if err != nil {
			status = "network_verification_failed"
		}
		if err == nil {
			err = s.once(ctx)
		}
		if ctx.Err() != nil {
			return
		}
		_ = s.Engine.SetProgress(ctx, s.Network, s.SourceID, "stream", status, nil)
		if s.Logger != nil {
			s.Logger.WarnContext(ctx, "beacon event stream unavailable; polling remains enabled", "retry_after", delay.String(), "error", err.Error())
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if delay < time.Minute {
			delay *= 2
			if delay > time.Minute {
				delay = time.Minute
			}
		}
	}
}

func (s *Stream) verifyNetwork(ctx context.Context) error {
	if s.VerifyNetwork == nil {
		return errors.New("network verifier is required before subscribing")
	}
	verifyCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return s.VerifyNetwork(verifyCtx)
}

func (s *Stream) once(ctx context.Context) error {
	u, err := url.Parse(s.URL)
	if err != nil {
		return errors.New("invalid event URL")
	}
	if !strings.HasSuffix(u.Path, "/eth/v1/events") {
		u.Path = strings.TrimRight(u.Path, "/") + "/eth/v1/events"
	}
	query := u.Query()
	query.Set("topics", "block,execution_payload_gossip,execution_payload,execution_payload_available,chain_reorg,payload_attestation_message")
	u.RawQuery = query.Encode()
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	req, err := http.NewRequestWithContext(streamCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return errors.New("invalid stream request")
	}
	req.Header.Set("Accept", "text/event-stream")
	// An activity watchdog bounds stalled headers and silent/broken connections.
	idle := s.IdleTimeout
	if idle <= 0 {
		idle = 30 * time.Second
	}
	activity := make(chan struct{}, 1)
	done := make(chan struct{})
	defer close(done)
	go func() {
		timer := time.NewTimer(idle)
		defer timer.Stop()
		for {
			select {
			case <-done:
				return
			case <-streamCtx.Done():
				return
			case <-activity:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(idle)
			case <-timer.C:
				cancel()
				return
			}
		}
	}()
	client := s.HTTPClient
	if client == nil {
		client = &http.Client{Transport: &http.Transport{ResponseHeaderTimeout: idle}}
	}
	defer client.CloseIdleConnections()
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("stream connection failed or idle timeout")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("stream HTTP status %d", resp.StatusCode)
	}
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return errors.New("stream returned non-SSE content")
	}
	start := time.Now().UTC()
	session := Session{ID: sessionID(), Start: start, Through: start}
	if err = s.Engine.Session(ctx, s.Network, "live", s.SourceID, session); err != nil {
		return err
	}
	defer func() {
		session.Closed = true
		finish, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		_ = s.Engine.Session(finish, s.Network, "live", s.SourceID, session)
	}()
	if err = s.Engine.SetProgress(ctx, s.Network, s.SourceID, "stream", "connected", nil); err != nil {
		return err
	}
	return ReadSSE(resp.Body, func() error {
		select {
		case activity <- struct{}{}:
		default:
		}
		session.Through = time.Now().UTC()
		// Durable coverage is advanced only by received bytes, never a local timer.
		return s.Engine.Session(ctx, s.Network, "live", s.SourceID, session)
	}, func(kind string, data []byte) error {
		event, wake, err := DecodeEvent(kind, data, s.Network, s.SourceID, session.ID, session.Through)
		if err != nil {
			return err
		}
		if event != nil {
			if _, _, err = s.Engine.Apply(ctx, *event); err != nil {
				return err
			}
		}
		if wake != nil && s.Wake != nil {
			select {
			case s.Wake <- *wake:
			default:
			}
		}
		return nil
	})
}

// ReadSSE handles comments, multiline data, CRLF, and bounded frames. Provider
// event IDs are not assumed to be resumable; polling repairs the reconnect gap.
func ReadSSE(reader io.Reader, activity func() error, handle func(string, []byte) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	kind := ""
	var data bytes.Buffer
	for scanner.Scan() {
		if err := activity(); err != nil {
			return err
		}
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if data.Len() > 0 {
				if err := handle(kind, bytes.TrimSuffix(data.Bytes(), []byte("\n"))); err != nil {
					return err
				}
			}
			kind = ""
			data.Reset()
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch key {
		case "event":
			kind = value
		case "data":
			data.WriteString(value)
			data.WriteByte('\n')
			if data.Len() > 1<<20 {
				return errors.New("SSE frame exceeds 1 MiB")
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return errors.New("stream read failed")
	}
	return io.EOF
}

func DecodeEvent(kind string, raw []byte, network, source, session string, at time.Time) (*Event, *uint64, error) {
	var value struct {
		Slot       string `json:"slot"`
		Block      string `json:"block"`
		Root       string `json:"block_root"`
		Hash       string `json:"block_hash"`
		Builder    string `json:"builder_index"`
		Optimistic *bool  `json:"execution_optimistic"`
		Data       struct {
			Data struct {
				Slot    string `json:"slot"`
				Root    string `json:"beacon_block_root"`
				Present bool   `json:"payload_present"`
				Blobs   bool   `json:"blob_data_available"`
			} `json:"data"`
			Validator string `json:"validator_index"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, nil, errors.New("invalid stream event JSON")
	}
	if kind == "payload_attestation_message" {
		v := value.Data.Data
		slot, err := decimalSlot(v.Slot)
		if err != nil || !ingest.ValidRoot(v.Root) {
			return nil, nil, errors.New("invalid PTC event identity")
		}
		return &Event{Network: network, Mode: "live", SourceID: source, Session: session, Kind: "ptc", Slot: slot, Root: strings.ToLower(v.Root), ObservedAt: at, Votes: &Votes{ValidatorIndex: value.Data.Validator, PayloadPresent: v.Present, BlobAvailable: v.Blobs}, Raw: append([]byte(nil), raw...)}, nil, nil
	}
	if kind == "chain_reorg" {
		slot, err := decimalSlot(value.Slot)
		if err != nil {
			return nil, nil, err
		}
		return nil, &slot, nil
	} // Polling reconciles the configured lookback window.
	slot, err := strconv.ParseUint(value.Slot, 10, 64)
	if err != nil {
		return nil, nil, errors.New("invalid stream slot")
	}
	root := value.Root
	if kind == "block" {
		root = value.Block
	}
	if !ingest.ValidRoot(root) {
		return nil, nil, errors.New("invalid stream block root")
	}
	e := &Event{Network: network, Mode: "live", SourceID: source, Session: session, Slot: slot, Root: strings.ToLower(root), PayloadHash: strings.ToLower(value.Hash), Builder: value.Builder, ObservedAt: at, Timed: true, Raw: append([]byte(nil), raw...)}
	switch kind {
	case "block":
		e.Kind = "block_seen"
	case "execution_payload_gossip":
		e.Kind = "payload_seen"
	case "execution_payload":
		e.Kind = "validation"
		if value.Optimistic != nil && !*value.Optimistic {
			e.Valid = boolPtr(true)
		}
	case "execution_payload_available":
		return nil, &slot, nil // Availability signal is not itself a committee quorum or full envelope.
	default:
		return nil, nil, nil
	}
	return e, &slot, nil
}
