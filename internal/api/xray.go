package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"rooted/internal/ingest"
	"rooted/internal/xray"
)

func (s *Server) xrayScope(w http.ResponseWriter, r *http.Request) bool {
	if s.Xray == nil || s.Network != "sepolia" {
		failure(w, 503, "unavailable", "Sepolia X-ray store unavailable")
		return false
	}
	if r.URL.Query().Get("network") != "sepolia" {
		failure(w, 400, "invalid_scope", "explicit network=sepolia is required")
		return false
	}
	return true
}
func xrayLimit(w http.ResponseWriter, r *http.Request, fallback, maximum int) (int, bool) {
	value := r.URL.Query().Get("limit")
	if value == "" {
		return fallback, true
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > maximum {
		failure(w, 400, "invalid_limit", "limit must be 1.."+strconv.Itoa(maximum))
		return 0, false
	}
	return n, true
}

// acquireReplay takes the replay gate shared by profiling, X-ray POSTs and the follower, so native
// replays never overlap. A short wait lets a request win the gate between follower ticks
// (a follow job holds it ~10 s of every 12 s).
func acquireReplay(ctx context.Context, gate chan struct{}) bool {
	wait, stop := context.WithTimeout(ctx, 15*time.Second)
	defer stop()
	select {
	case gate <- struct{}{}:
		return true
	case <-wait.Done():
		return false
	}
}
func (s *Server) xrayHash(w http.ResponseWriter, r *http.Request) (string, bool) {
	hash := strings.ToLower(r.PathValue("hash"))
	if !ingest.ValidRoot(hash) {
		failure(w, 400, "invalid_hash", "block hash must be 32 bytes")
		return "", false
	}
	return hash, true
}
func (s *Server) xrayBlock(w http.ResponseWriter, r *http.Request) {
	if !s.xrayScope(w, r) {
		return
	}
	hash, ok := s.xrayHash(w, r)
	if !ok {
		return
	}
	report, err := s.Xray.Get(r.Context(), hash)
	if errors.Is(err, pgx.ErrNoRows) {
		failure(w, 404, "not_found", "no stored X-ray; POST to compute")
		return
	}
	if err != nil {
		failure(w, 500, "storage_error", "unable to read X-ray")
		return
	}
	write(w, 200, map[string]any{"data": report})
}
func (s *Server) xrayBlocks(w http.ResponseWriter, r *http.Request) {
	if !s.xrayScope(w, r) {
		return
	}
	limit, ok := xrayLimit(w, r, 50, 200)
	if !ok {
		return
	}
	briefs, err := s.Xray.List(r.Context(), limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read X-rays")
		return
	}
	write(w, 200, map[string]any{"data": briefs})
}
func (s *Server) xraySummary(w http.ResponseWriter, r *http.Request) {
	if !s.xrayScope(w, r) {
		return
	}
	limit, ok := xrayLimit(w, r, 2000, 10000)
	if !ok {
		return
	}
	briefs, err := s.Xray.List(r.Context(), limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read X-rays")
		return
	}
	write(w, 200, map[string]any{"data": xray.Summarize(briefs)})
}
func (s *Server) xrayUniswap(w http.ResponseWriter, r *http.Request) {
	if !s.xrayScope(w, r) {
		return
	}
	limit, ok := xrayLimit(w, r, 50, 200)
	if !ok {
		return
	}
	scan, err := s.Xray.Uniswap(r.Context(), limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read X-rays")
		return
	}
	write(w, 200, map[string]any{"data": scan})
}
func (s *Server) xrayCreate(w http.ResponseWriter, r *http.Request) {
	if !s.xrayScope(w, r) {
		return
	}
	hash, ok := s.xrayHash(w, r)
	if !ok {
		return
	}
	if s.XrayEngine == nil || s.XrayGate == nil {
		failure(w, 503, "unavailable", "X-ray engine unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 85*time.Second)
	defer cancel()
	if !acquireReplay(ctx, s.XrayGate) {
		failure(w, 429, "busy", "a native replay is already running; retry later")
		return
	}
	defer func() { <-s.XrayGate }()
	report, err := s.XrayEngine.Block(ctx, hash, "live")
	if errors.Is(err, xray.ErrStorage) {
		failure(w, 500, "storage_error", "unable to save X-ray")
		return
	}
	if err != nil {
		failure(w, 422, "xray_unavailable", err.Error())
		return
	}
	write(w, 201, map[string]any{"data": report})
}
