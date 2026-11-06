package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"rooted/internal/ingest"
	"strings"
)

const frameConformanceSchema = "rooted-frame-conformance-v1"

// frameConformance serves the committed boundary-case run and joins each case
// with Rooted's durable archive status for its transaction hash.
func (s *Server) frameConformance(w http.ResponseWriter, r *http.Request) {
	scope, _, ok := s.frameScope(w, r)
	if !ok {
		return
	}
	path := os.Getenv("ROOTED_FRAME_CONFORMANCE_FILE")
	if path == "" {
		path = "integrations/frame-conformance/results.json"
	}
	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		failure(w, 404, "not_found", "no frame conformance results recorded")
		return
	}
	if err != nil {
		failure(w, 500, "invalid_results", "unable to read frame conformance results")
		return
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		failure(w, 500, "invalid_results", "frame conformance results exceed 1 MiB or cannot be read")
		return
	}
	var doc map[string]any
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	if d.Decode(&doc) != nil || doc["schema"] != frameConformanceSchema {
		failure(w, 500, "invalid_results", "frame conformance results have an unsupported schema")
		return
	}
	// Cases are archived in the scope of the node they were submitted to.
	if node, _ := doc["node"].(string); r.URL.Query().Get("node") == "" && (node == "gateway" || node == "miner") {
		scope.Node = node
	}
	cases, ok := doc["cases"].([]any)
	if !ok {
		failure(w, 500, "invalid_results", "frame conformance results have no case list")
		return
	}
	for _, item := range cases {
		c, ok := item.(map[string]any)
		if !ok {
			failure(w, 500, "invalid_results", "frame conformance case must be an object")
			return
		}
		c["archive_status"] = nil
		hash, _ := c["tx_hash"].(string)
		if !ingest.ValidRoot(hash) {
			continue
		}
		states, err := s.Frames.States(r.Context(), scope, strings.ToLower(hash), 1)
		if err != nil {
			failure(w, 500, "storage_error", "unable to read frame states")
			return
		}
		if len(states) == 1 {
			c["archive_status"] = states[0].Status
		}
	}
	write(w, 200, map[string]any{"data": doc})
}
