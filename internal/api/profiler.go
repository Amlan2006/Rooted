package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"rooted/internal/ingest"
	"rooted/internal/profiler"
	"strings"
	"time"
)

func (s *Server) profileScope(w http.ResponseWriter, r *http.Request) bool {
	if s.Profiles == nil || s.Profiler == nil || s.Network != "sepolia" {
		failure(w, 503, "unavailable", "Sepolia replay profiler unavailable")
		return false
	}
	if r.URL.Query().Get("network") != "sepolia" || r.URL.Query().Get("mode") != "replay" {
		failure(w, 400, "invalid_scope", "explicit network=sepolia&mode=replay is required")
		return false
	}
	return true
}
func (s *Server) profiles(w http.ResponseWriter, r *http.Request) {
	if !s.profileScope(w, r) {
		return
	}
	id := strings.ToLower(r.PathValue("id"))
	if id != "" && !ingest.ValidRoot(id) {
		failure(w, 400, "invalid_id", "invalid immutable profile identity")
		return
	}
	reports, err := s.Profiles.List(r.Context(), id)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read profiles")
		return
	}
	if id != "" {
		if len(reports) == 0 {
			failure(w, 404, "not_found", "profile not found")
			return
		}
		write(w, 200, map[string]any{"data": reports[0]})
		return
	}
	write(w, 200, map[string]any{"data": reports})
}
func (s *Server) profileCapture(w http.ResponseWriter, r *http.Request) {
	if !s.profileScope(w, r) {
		return
	}
	id := strings.ToLower(r.PathValue("id"))
	if !ingest.ValidRoot(id) {
		failure(w, 400, "invalid_id", "invalid profile identity")
		return
	}
	raw, err := s.Profiles.Capture(r.Context(), id)
	if err != nil {
		failure(w, 404, "unavailable", "profile capture unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(raw)
}
func (s *Server) profileCreate(w http.ResponseWriter, r *http.Request) {
	if !s.profileScope(w, r) {
		return
	}
	if r.Header.Get("Content-Type") != "application/json" {
		failure(w, 415, "content_type", "application/json required")
		return
	}
	var input *struct {
		BlockHash string `json:"block_hash"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	id := strings.ToLower(r.PathValue("id"))
	if decoder.Decode(&input) != nil || input == nil || (id == "" && !ingest.ValidRoot(input.BlockHash)) || (id != "" && (!ingest.ValidRoot(id) || input.BlockHash != "")) {
		failure(w, 400, "invalid_request", "provide only an immutable block_hash")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		failure(w, 400, "invalid_request", "provide a single request")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 85*time.Second)
	defer cancel()
	if !acquireReplay(ctx, s.ProfileGate) {
		failure(w, 429, "busy", "a profile is already running; retry later")
		return
	}
	defer func() { <-s.ProfileGate }()
	var report profiler.Report
	var capture []byte
	var err error
	if id == "" {
		report, capture, err = s.Profiler.Capture(ctx, strings.ToLower(input.BlockHash))
	} else {
		reports, e := s.Profiles.List(ctx, id)
		if e != nil || len(reports) != 1 {
			failure(w, 404, "not_found", "saved profile not found")
			return
		}
		capture, err = s.Profiles.Capture(ctx, id)
		if err == nil {
			metadata := reports[0]
			metadata.CaptureMode = "recorded_capture"
			if metadata.InputCapturedAt.IsZero() {
				metadata.InputCapturedAt = metadata.CapturedAt
			}
			report, capture, err = s.Profiler.Measure(ctx, metadata, capture)
		}
	}
	if err != nil {
		failure(w, 422, "replay_unavailable", err.Error())
		return
	}
	if err = s.Profiles.Correlate(ctx, &report); err == nil {
		err = s.Profiles.Save(ctx, report, capture)
	}
	if err != nil {
		failure(w, 500, "storage_error", "unable to save profile")
		return
	}
	write(w, 201, map[string]any{"data": report})
}
