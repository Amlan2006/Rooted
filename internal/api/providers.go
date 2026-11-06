package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"rooted/internal/providers"
	"strings"
	"time"
)

func (s *Server) providerScope(w http.ResponseWriter, r *http.Request) bool {
	if s.Providers == nil || s.ProviderChecks == nil || s.Network != "sepolia" {
		failure(w, 503, "unavailable", "Sepolia provider comparison is not configured")
		return false
	}
	if r.URL.Query().Get("network") != "sepolia" || (r.URL.Query().Get("mode") != "" && r.URL.Query().Get("mode") != "live") {
		failure(w, 400, "invalid_network", "explicit network=sepolia is required")
		return false
	}
	return true
}
func (s *Server) providerComparisons(w http.ResponseWriter, r *http.Request) {
	if !s.providerScope(w, r) {
		return
	}
	hash, id := strings.ToLower(r.URL.Query().Get("block_hash")), strings.ToLower(r.PathValue("id"))
	if (hash != "" && !providers.ValidHash(hash)) || (id != "" && !providers.ValidHash(id)) {
		failure(w, 400, "invalid_identity", "expected immutable 32-byte hex identities")
		return
	}
	reports, err := s.Providers.List(r.Context(), hash, id)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read provider comparisons")
		return
	}
	if id != "" {
		if len(reports) == 0 {
			failure(w, 404, "not_found", "comparison not found")
			return
		}
		write(w, 200, map[string]any{"data": reports[0]})
		return
	}
	write(w, 200, map[string]any{"data": reports})
}
func (s *Server) providerCompare(w http.ResponseWriter, r *http.Request) {
	if !s.providerScope(w, r) {
		return
	}
	if r.Header.Get("Content-Type") != "application/json" {
		failure(w, 415, "invalid_content_type", "application/json is required")
		return
	}
	var input *struct {
		BlockHash string `json:"block_hash"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input == nil {
		failure(w, 400, "invalid_request", "provide only an optional block_hash")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		failure(w, 400, "invalid_request", "provide a single JSON object")
		return
	}
	input.BlockHash = strings.ToLower(input.BlockHash)
	if input.BlockHash != "" && !providers.ValidHash(input.BlockHash) {
		failure(w, 400, "invalid_identity", "block_hash must be a 32-byte hex hash")
		return
	}
	select {
	case s.ProviderGate <- struct{}{}:
		defer func() { <-s.ProviderGate }()
	default:
		failure(w, 429, "busy", "a provider comparison is already running; retry after it completes")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()
	if input.BlockHash == "" {
		hash, err := s.ProviderChecks.Latest(ctx)
		if err != nil {
			failure(w, 502, "finalized_unavailable", "primary finalized block unavailable; provide a known block hash or retry")
			return
		}
		input.BlockHash = hash
	}
	report, err := s.ProviderChecks.Compare(ctx, input.BlockHash)
	if err != nil {
		failure(w, 502, "comparison_failed", "provider comparison could not complete")
		return
	}
	if ctx.Err() != nil {
		failure(w, 504, "comparison_timeout", "comparison timed out; retry")
		return
	}
	if s.Providers.Save(ctx, report) != nil {
		failure(w, 500, "storage_error", "unable to save provider comparison")
		return
	}
	write(w, 201, map[string]any{"data": report})
}
