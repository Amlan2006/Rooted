package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"rooted/internal/analyst"
)

func (s *Server) analystScope(w http.ResponseWriter, r *http.Request) bool {
	if s.Analyst == nil || s.Network != "sepolia" {
		failure(w, 503, "unavailable", "Sepolia analyst brief store unavailable")
		return false
	}
	if r.URL.Query().Get("network") != "sepolia" {
		failure(w, 400, "invalid_scope", "explicit network=sepolia is required")
		return false
	}
	return true
}
func (s *Server) analystBriefs(w http.ResponseWriter, r *http.Request) {
	if !s.analystScope(w, r) {
		return
	}
	limit, ok := xrayLimit(w, r, 20, 100)
	if !ok {
		return
	}
	briefs, err := s.Analyst.List(r.Context(), limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read analyst briefs")
		return
	}
	write(w, 200, map[string]any{"data": briefs})
}
func (s *Server) analystBriefCreate(w http.ResponseWriter, r *http.Request) {
	if !s.analystScope(w, r) {
		return
	}
	if r.Header.Get("Content-Type") != "application/json" {
		failure(w, 415, "invalid_content_type", "application/json is required")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		failure(w, 413, "too_large", "brief request exceeds 64 KiB")
		return
	}
	var input *analyst.Brief
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err != nil || decoder.Decode(&input) != nil || input == nil || decoder.Decode(new(any)) != io.EOF {
		failure(w, 400, "invalid_request", "provide one JSON object with block_hash, block_number, triggers, brief, evidence, model, usd")
		return
	}
	if input.Network == "" {
		input.Network = "sepolia"
	}
	input.BlockHash = strings.ToLower(input.BlockHash)
	if err := analyst.Check(*input); err != nil {
		failure(w, 400, "invalid_brief", err.Error())
		return
	}
	saved, err := s.Analyst.Save(r.Context(), *input)
	if err != nil {
		failure(w, 500, "storage_error", "unable to save analyst brief")
		return
	}
	write(w, 200, map[string]any{"data": saved})
}
