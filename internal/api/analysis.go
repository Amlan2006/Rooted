package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"rooted/internal/analysis"
	"rooted/internal/ingest"
	"strconv"
	"strings"
)

func (s *Server) analysisScope(w http.ResponseWriter, r *http.Request) (string, string, int, bool) {
	network := r.URL.Query().Get("network")
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "live"
	}
	if s.Analysis == nil {
		failure(w, 503, "analysis_unavailable", "analysis store is not configured")
		return "", "", 0, false
	}
	if network != s.Network && network != s.Network+"-fork" {
		failure(w, 400, "invalid_network", "explicitly select the configured execution network or its local fork")
		return "", "", 0, false
	}
	if mode != "live" && mode != "fork" && mode != "captured" && mode != "synthetic" {
		failure(w, 400, "invalid_mode", "mode must be live, fork, captured, or synthetic")
		return "", "", 0, false
	}
	if network == s.Network+"-fork" && mode != "fork" || network == s.Network && mode == "fork" {
		failure(w, 400, "invalid_mode", "fork evidence must use the fork network and mode")
		return "", "", 0, false
	}
	limit := 5
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 20 {
			failure(w, 400, "invalid_limit", "limit must be 1..20")
			return "", "", 0, false
		}
		limit = n
	}
	return network, mode, limit, true
}
func (s *Server) analysisList(w http.ResponseWriter, r *http.Request) {
	network, mode, limit, ok := s.analysisScope(w, r)
	if !ok {
		return
	}
	hash := strings.ToLower(r.PathValue("hash"))
	if hash != "" && !ingest.ValidRoot(hash) {
		failure(w, 400, "invalid_hash", "block hash must be 32 bytes")
		return
	}
	runs, err := s.Analysis.List(r.Context(), network, mode, hash, "", limit)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read analysis")
		return
	}
	write(w, 200, map[string]any{"network": network, "mode": mode, "data": runs})
}
func (s *Server) analysisRun(w http.ResponseWriter, r *http.Request) {
	network, mode, _, ok := s.analysisScope(w, r)
	if !ok {
		return
	}
	id := strings.ToLower(r.PathValue("id"))
	if !ingest.ValidRoot(id) {
		failure(w, 400, "invalid_id", "analysis ID must be a 32-byte hash")
		return
	}
	runs, err := s.Analysis.List(r.Context(), network, mode, "", id, 1)
	if err != nil {
		failure(w, 500, "storage_error", "unable to read analysis")
		return
	}
	if len(runs) == 0 {
		failure(w, 404, "analysis_not_found", "analysis not found in this scope")
		return
	}
	run := runs[0]
	switch r.PathValue("view") {
	case "bal":
		write(w, 200, map[string]any{"id": id, "native_bal": run.Native, "coverage": run.Coverage})
	case "dependencies":
		write(w, 200, map[string]any{"id": id, "transaction_access": run.Access, "graph": run.Graph, "storage_projection": run.StorageGraph})
	case "uniswap":
		write(w, 200, map[string]any{"id": id, "pools": run.Pools, "swaps": run.Swaps, "swap_calls": run.Attempts, "storage_labels": run.StorageLabels, "coverage": run.Coverage})
	case "evidence":
		offset := 0
		if v := r.URL.Query().Get("offset"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || n > 10000 {
				failure(w, 400, "invalid_offset", "offset must be 0..10000")
				return
			}
			offset = n
		}
		evidence, err := s.Analysis.Evidence(r.Context(), id, 10, offset)
		if err != nil {
			failure(w, 500, "storage_error", "unable to read evidence")
			return
		}
		write(w, 200, map[string]any{"id": id, "offset": offset, "next_offset": offset + len(evidence), "data": evidence})
	case "":
		write(w, 200, map[string]any{"data": run})
	default:
		failure(w, 404, "not_found", "unknown analysis view")
	}
}
func (s *Server) analysisIngest(w http.ResponseWriter, r *http.Request) {
	network, mode, _, ok := s.analysisScope(w, r)
	if !ok {
		return
	}
	if network != s.Network || mode != "live" || s.Analyzer == nil {
		failure(w, 400, "invalid_ingestion_scope", "HTTP ingestion supports only the configured live network; use the local CLI for fork analysis")
		return
	}
	var body struct {
		Transactions []string `json:"transactions"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		failure(w, 400, "invalid_body", "provide JSON with at most four transaction hashes")
		return
	}
	if decoder.Decode(new(any)) != io.EOF || len(body.Transactions) > 4 {
		failure(w, 400, "invalid_body", "at most four traced transactions per request")
		return
	}
	hash := r.PathValue("hash")
	txHash := r.PathValue("tx")
	requested := hash
	if txHash != "" {
		requested = txHash
	}
	if !ingest.ValidRoot(requested) {
		failure(w, 400, "invalid_hash", "provide a 32-byte transaction or block hash")
		return
	}
	seen := map[string]bool{}
	for _, hash := range body.Transactions {
		hash = strings.ToLower(hash)
		if !ingest.ValidRoot(hash) || seen[hash] {
			failure(w, 400, "invalid_body", "transaction hashes must be unique 32-byte values")
			return
		}
		seen[hash] = true
	}

	if txHash != "" {
		if len(body.Transactions) != 0 {
			failure(w, 400, "invalid_body", "transaction lookup takes an empty JSON object")
			return
		}
		var err error
		hash, err = s.Analyzer.ResolveTransactionBlock(r.Context(), txHash)
		if err != nil {
			switch {
			case errors.Is(err, analysis.ErrTransactionNotFound):
				failure(w, 404, "transaction_not_found", "transaction not found on the configured Sepolia node")
			case errors.Is(err, analysis.ErrTransactionPending):
				failure(w, 409, "transaction_pending", "transaction is pending; retry after it is included in a block")
			default:
				failure(w, 502, "transaction_lookup_failed", "unable to resolve transaction from the configured execution node")
			}
			return
		}
		body.Transactions = []string{strings.ToLower(txHash)}
	}
	snapshot, err := s.Analyzer.Fetch(r.Context(), hash, body.Transactions)
	if err != nil {
		failure(w, 502, "analysis_failed", "native BAL or bound source evidence unavailable; inspect collector configuration")
		return
	}
	if err = s.Analysis.Save(r.Context(), snapshot); err != nil {
		failure(w, 500, "storage_error", "unable to save analysis")
		return
	}
	write(w, 200, map[string]any{"data": snapshot.Run})
}
