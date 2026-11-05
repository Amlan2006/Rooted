package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) watchScope(w http.ResponseWriter, r *http.Request) (string, string, int, bool) {
	if s.Watch == nil {
		failure(w, 503, "collector_unavailable", "PayloadWatch is not configured")
		return "", "", 0, false
	}
	if r.URL.Query().Get("network") != s.Network {
		failure(w, 400, "invalid_network", "network must explicitly match configured network")
		return "", "", 0, false
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "live"
	}
	if mode != "live" && mode != "replay" && mode != "synthetic" {
		failure(w, 400, "invalid_mode", "mode must be live, replay, or synthetic")
		return "", "", 0, false
	}
	source := r.URL.Query().Get("source")
	if source == "" {
		source = s.SourceID
	}
	if len(source) > 100 {
		failure(w, 400, "invalid_source", "source is too long")
		return "", "", 0, false
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > 200 {
			failure(w, 400, "invalid_limit", "limit must be 1..200")
			return "", "", 0, false
		}
		limit = n
	}
	return mode, source, limit, true
}
func (s *Server) watchSlots(w http.ResponseWriter, r *http.Request) {
	mode, source, limit, ok := s.watchScope(w, r)
	if !ok {
		return
	}
	var slot *uint64
	if r.PathValue("slot") != "" {
		n, err := strconv.ParseUint(r.PathValue("slot"), 10, 64)
		if err != nil {
			failure(w, 400, "invalid_slot", "slot must be unsigned decimal")
			return
		}
		slot = &n
	}
	states, err := s.Watch.States(r.Context(), s.Network, mode, source, slot, "", limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read PayloadWatch state")
		return
	}
	write(w, 200, map[string]any{"network": s.Network, "mode": mode, "source": source, "data": states})
}
func (s *Server) builders(w http.ResponseWriter, r *http.Request) {
	mode, source, _, ok := s.watchScope(w, r)
	if !ok {
		return
	}
	window := time.Hour
	if value := r.URL.Query().Get("window"); value != "" {
		d, err := time.ParseDuration(value)
		if err != nil || d < time.Minute || d > 7*24*time.Hour {
			failure(w, 400, "invalid_window", "window must be 1m..168h")
			return
		}
		window = d
	}
	builder := r.PathValue("builder")
	if builder != "" {
		if _, err := strconv.ParseUint(builder, 10, 64); err != nil {
			failure(w, 400, "invalid_builder", "builder must be an unsigned decimal index")
			return
		}
	}
	since := time.Now().UTC().Add(-window)
	stats, err := s.Watch.Builders(r.Context(), s.Network, mode, source, builder, since)
	if err != nil {
		failure(w, 500, "storage_error", "unable to aggregate builders")
		return
	}
	write(w, 200, map[string]any{"network": s.Network, "mode": mode, "source": source, "window_start": since, "denominator": "canonical selected commitments first observed in window; ratios are observation coverage, not reputation", "data": stats})
}
func (s *Server) alerts(w http.ResponseWriter, r *http.Request) {
	mode, source, limit, ok := s.watchScope(w, r)
	if !ok {
		return
	}
	alerts, err := s.Watch.Alerts(r.Context(), s.Network, mode, source, limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read alerts")
		return
	}
	write(w, 200, map[string]any{"network": s.Network, "mode": mode, "source": source, "data": alerts})
}
func (s *Server) timeline(w http.ResponseWriter, r *http.Request) {
	mode, source, limit, ok := s.watchScope(w, r)
	if !ok {
		return
	}
	slot, err := strconv.ParseUint(r.PathValue("slot"), 10, 64)
	if err != nil {
		failure(w, 400, "invalid_slot", "slot must be unsigned decimal")
		return
	}
	var after int64
	if value := r.URL.Query().Get("after"); value != "" {
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil || n < 0 {
			failure(w, 400, "invalid_cursor", "after must be nonnegative")
			return
		}
		after = n
	}
	entries, err := s.Watch.Events(r.Context(), s.Network, mode, source, after, &slot, limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read timeline")
		return
	}
	write(w, 200, map[string]any{"network": s.Network, "mode": mode, "source": source, "data": entries})
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	if s.Watch == nil {
		failure(w, 503, "collector_unavailable", "PayloadWatch not configured")
		return
	}
	text, err := s.Watch.Metrics(r.Context(), s.Network, "live", s.SourceID)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read metrics")
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(text))
}
func (s *Server) collectorStatus(w http.ResponseWriter, r *http.Request) {
	_, source, _, ok := s.watchScope(w, r)
	if !ok {
		return
	}
	progress, err := s.Watch.Progress(r.Context(), s.Network, source)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read collector status")
		return
	}
	write(w, 200, map[string]any{"network": s.Network, "source": source, "data": progress, "local_late_after_ms": s.Watch.Policy.LateAfter.Milliseconds(), "local_missing_after_ms": s.Watch.Policy.MissingAfter.Milliseconds(), "ptc_quorum": s.Watch.Policy.PTCQuorum, "ptc_size": s.Watch.Policy.PTCSize})
}
func (s *Server) live(w http.ResponseWriter, r *http.Request) {
	mode, source, _, ok := s.watchScope(w, r)
	if !ok {
		return
	}
	cursorText := r.Header.Get("Last-Event-ID")
	if cursorText == "" {
		cursorText = r.URL.Query().Get("after")
	}
	var cursor int64
	if cursorText != "" {
		n, err := strconv.ParseInt(cursorText, 10, 64)
		if err != nil || n < 0 {
			failure(w, 400, "invalid_cursor", "event cursor must be a nonnegative integer")
			return
		}
		cursor = n
	}
	controller := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	var lastSnapshot string
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		entries, err := s.Watch.Events(r.Context(), s.Network, mode, source, cursor, nil, 100)
		if err != nil {
			return
		}
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if len(entries) == 0 {
			if _, err = fmt.Fprint(w, ": heartbeat\n\n"); err != nil {
				return
			}
		}
		for _, entry := range entries {
			body, err := json.Marshal(entry)
			if err != nil {
				return
			}
			if _, err = fmt.Fprintf(w, "id: %d\nevent: observation\ndata: %s\n\n", entry.Sequence, body); err != nil {
				return
			}
			cursor = entry.Sequence
		}
		states, err := s.Watch.States(r.Context(), s.Network, mode, source, nil, "", 50)
		if err != nil {
			return
		}
		alerts, err := s.Watch.Alerts(r.Context(), s.Network, mode, source, 50)
		if err != nil {
			return
		}
		snapshot, err := json.Marshal(map[string]any{"states": states, "alerts": alerts})
		if err != nil {
			return
		}
		if string(snapshot) != lastSnapshot {
			if _, err = fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", snapshot); err != nil {
				return
			}
			lastSnapshot = string(snapshot)
		}
		if controller.Flush() != nil {
			return
		}
		if len(entries) == 100 {
			continue
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
