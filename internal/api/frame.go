package api

import (
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"rooted/internal/framemempool"
	"rooted/internal/ingest"
	"strconv"
	"strings"
)

func (s *Server) frameScope(w http.ResponseWriter, r *http.Request) (framemempool.Scope, int, bool) {
	scope := framemempool.Scope{Network: r.URL.Query().Get("network"), Mode: r.URL.Query().Get("mode"), Node: r.URL.Query().Get("node")}
	if s.Frames == nil {
		failure(w, 503, "frame_unavailable", "frame store not configured")
		return scope, 0, false
	}
	if scope.Network != s.FrameNetwork {
		failure(w, 400, "invalid_network", "select the configured frame devnet explicitly")
		return scope, 0, false
	}
	if scope.Mode == "" {
		scope.Mode = "live"
	}
	if scope.Mode != "live" && scope.Mode != "captured" && scope.Mode != "synthetic" {
		failure(w, 400, "invalid_mode", "mode must be live, captured, or synthetic")
		return scope, 0, false
	}
	if scope.Node == "" {
		scope.Node = "gateway"
	}
	if scope.Node != "gateway" && scope.Node != "miner" {
		failure(w, 400, "invalid_node", "node must be gateway or miner")
		return scope, 0, false
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 || n > 200 {
			failure(w, 400, "invalid_limit", "limit must be 1..200")
			return scope, 0, false
		}
		limit = n
	}
	return scope, limit, true
}
func (s *Server) frameTransactions(w http.ResponseWriter, r *http.Request) {
	scope, limit, ok := s.frameScope(w, r)
	if !ok {
		return
	}
	hash := strings.ToLower(r.PathValue("hash"))
	if hash != "" && !ingest.ValidRoot(hash) {
		failure(w, 400, "invalid_hash", "transaction hash must be 32 bytes")
		return
	}
	states, err := s.Frames.States(r.Context(), scope, hash, limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read frame states")
		return
	}
	if hash != "" && len(states) == 0 {
		failure(w, 404, "frame_not_observed", "no stored frame observation in this scope")
		return
	}
	write(w, 200, map[string]any{"scope": scope, "data": states})
}
func (s *Server) frameNode(w http.ResponseWriter, r *http.Request) {
	scope, _, ok := s.frameScope(w, r)
	if !ok {
		return
	}
	node, err := s.Frames.Node(r.Context(), scope)
	if errors.Is(err, pgx.ErrNoRows) {
		failure(w, 404, "frame_node_not_observed", "collector has not verified this frame node yet")
		return
	}
	if err != nil {
		failure(w, 500, "storage_error", "unable to read frame node")
		return
	}
	write(w, 200, map[string]any{"data": node})
}
func (s *Server) frameIncidents(w http.ResponseWriter, r *http.Request) {
	scope, limit, ok := s.frameScope(w, r)
	if !ok {
		return
	}
	items, err := s.Frames.Incidents(r.Context(), scope, limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read frame incidents")
		return
	}
	write(w, 200, map[string]any{"scope": scope, "data": items})
}
func (s *Server) frameEvidence(w http.ResponseWriter, r *http.Request) {
	scope, limit, ok := s.frameScope(w, r)
	if !ok {
		return
	}
	hash := strings.ToLower(r.PathValue("hash"))
	if !ingest.ValidRoot(hash) {
		failure(w, 400, "invalid_hash", "transaction hash must be 32 bytes")
		return
	}
	after := int64(0)
	if text := r.URL.Query().Get("after"); text != "" {
		n, err := strconv.ParseInt(text, 10, 64)
		if err != nil || n < 0 {
			failure(w, 400, "invalid_cursor", "after must be nonnegative")
			return
		}
		after = n
	}
	entries, err := s.Frames.Evidence(r.Context(), scope, hash, after, limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read raw frame evidence")
		return
	}
	write(w, 200, map[string]any{"scope": scope, "data": entries})
}
func (s *Server) frameSubmissions(w http.ResponseWriter, r *http.Request) {
	scope, limit, ok := s.frameScope(w, r)
	if !ok {
		return
	}
	items, err := s.Frames.Submissions(r.Context(), scope, limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read submission attempts")
		return
	}
	write(w, 200, map[string]any{"scope": scope, "data": items})
}
