package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"rooted/internal/analysis"
	"rooted/internal/analyst"
	"rooted/internal/domain"
	"rooted/internal/framemempool"
	"rooted/internal/ingest"
	"rooted/internal/payloadwatch"
	"rooted/internal/profiler"
	"rooted/internal/providers"
	"rooted/internal/storage"
	"rooted/internal/xray"
)

type Fetcher interface {
	Fetch(context.Context, uint64) (domain.Snapshot, error)
}
type Server struct {
	Repository     storage.Repository
	Collector      Fetcher
	Network        string
	Logger         *slog.Logger
	Watch          *payloadwatch.Engine
	SourceID       string
	Analysis       *analysis.Store
	Analyzer       *analysis.Collector
	Providers      *providers.Store
	ProviderChecks *providers.Collector
	ProviderGate   chan struct{}
	Profiles       *profiler.Store
	Profiler       *profiler.Collector
	ProfileGate    chan struct{}
	Frames         *framemempool.Store
	FrameNetwork   string
	Xray           *xray.Store
	XrayEngine     *xray.Engine
	XrayGate       chan struct{}
	Analyst        *analyst.Store
}
type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}
type ErrorDetail struct {
	Code       string   `json:"code"`
	Message    string   `json:"message"`
	BlockRoots []string `json:"block_roots,omitempty"`
}
type ObservationResponse struct {
	Data domain.Observation `json:"data"`
}
type HealthResponse struct {
	Status  string `json:"status"`
	Network string `json:"network"`
}

func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, status int, code, message string) {
	write(w, status, ErrorResponse{Error: ErrorDetail{Code: code, Message: message}})
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /api/v1/slots/{slot}", s.get)
	mux.HandleFunc("POST /api/v1/slots/{slot}/ingest", s.ingest)
	mux.HandleFunc("GET /api/v1/slots", s.watchSlots)
	mux.HandleFunc("GET /api/v1/payloadwatch/slots/{slot}", s.watchSlots)
	mux.HandleFunc("GET /api/v1/payloadwatch/slots/{slot}/timeline", s.timeline)
	mux.HandleFunc("GET /api/v1/builders", s.builders)
	mux.HandleFunc("GET /api/v1/builders/{builder}", s.builders)
	mux.HandleFunc("GET /api/v1/alerts", s.alerts)
	mux.HandleFunc("GET /api/v1/collector", s.collectorStatus)
	mux.HandleFunc("GET /api/v1/live", s.live)
	mux.HandleFunc("GET /metrics", s.metrics)
	mux.HandleFunc("GET /api/v1/providers/comparisons", s.providerComparisons)
	mux.HandleFunc("GET /api/v1/providers/comparisons/{id}", s.providerComparisons)
	mux.HandleFunc("POST /api/v1/providers/compare", s.providerCompare)
	mux.HandleFunc("GET /api/v1/profiles", s.profiles)
	mux.HandleFunc("GET /api/v1/profiles/{id}", s.profiles)
	mux.HandleFunc("GET /api/v1/profiles/{id}/capture", s.profileCapture)
	mux.HandleFunc("POST /api/v1/profiles", s.profileCreate)
	mux.HandleFunc("POST /api/v1/profiles/{id}/replay", s.profileCreate)
	mux.HandleFunc("GET /api/v1/analysis/runs", s.analysisList)
	mux.HandleFunc("GET /api/v1/analysis/blocks/{hash}", s.analysisList)
	mux.HandleFunc("POST /api/v1/analysis/blocks/{hash}/ingest", s.analysisIngest)
	mux.HandleFunc("POST /api/v1/analysis/transactions/{tx}/ingest", s.analysisIngest)
	mux.HandleFunc("GET /api/v1/analysis/runs/{id}", s.analysisRun)
	mux.HandleFunc("GET /api/v1/analysis/runs/{id}/{view}", s.analysisRun)
	mux.HandleFunc("GET /api/v1/frames/node", s.frameNode)
	mux.HandleFunc("GET /api/v1/frames/transactions", s.frameTransactions)
	mux.HandleFunc("GET /api/v1/frames/transactions/{hash}", s.frameTransactions)
	mux.HandleFunc("GET /api/v1/frames/transactions/{hash}/evidence", s.frameEvidence)
	mux.HandleFunc("GET /api/v1/frames/incidents", s.frameIncidents)
	mux.HandleFunc("GET /api/v1/frames/submissions", s.frameSubmissions)
	mux.HandleFunc("GET /api/v1/frames/conformance", s.frameConformance)
	mux.HandleFunc("GET /api/v1/xray/blocks", s.xrayBlocks)
	mux.HandleFunc("GET /api/v1/xray/blocks/{hash}", s.xrayBlock)
	mux.HandleFunc("POST /api/v1/xray/blocks/{hash}", s.xrayCreate)
	mux.HandleFunc("GET /api/v1/xray/summary", s.xraySummary)
	mux.HandleFunc("GET /api/v1/analyst/briefs", s.analystBriefs)
	mux.HandleFunc("POST /api/v1/analyst/briefs", s.analystBriefCreate)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { failure(w, 404, "not_found", "route not found") })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ctx, cancel := context.WithCancel(r.Context())
		if r.URL.Path != "/api/v1/live" {
			cancel()
			ctx, cancel = context.WithTimeout(r.Context(), 90*time.Second)
		}
		defer cancel()
		mux.ServeHTTP(w, r.WithContext(ctx))
		if s.Logger != nil {
			s.Logger.InfoContext(ctx, "request completed", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(start).Milliseconds())
		}
	})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if s.Repository.Ping(ctx) != nil {
		write(w, 503, HealthResponse{Status: "unavailable", Network: s.Network})
		return
	}
	write(w, 200, HealthResponse{Status: "ok", Network: s.Network})
}
func (s *Server) parameters(w http.ResponseWriter, r *http.Request) (uint64, bool) {
	if r.URL.Query().Get("network") != s.Network {
		failure(w, 400, "invalid_network", "network must explicitly match the configured network")
		return 0, false
	}
	slot, err := strconv.ParseUint(r.PathValue("slot"), 10, 64)
	if err != nil {
		failure(w, 400, "invalid_slot", "slot must be an unsigned decimal integer")
		return 0, false
	}
	return slot, true
}
func (s *Server) get(w http.ResponseWriter, r *http.Request) {
	slot, ok := s.parameters(w, r)
	if !ok {
		return
	}
	root := r.URL.Query().Get("block_root")
	if root != "" && !ingest.ValidRoot(root) {
		failure(w, 400, "invalid_root", "block_root must be a 32-byte hex root")
		return
	}
	items, err := s.Repository.List(r.Context(), s.Network, slot, strings.ToLower(root))
	if err != nil {
		failure(w, 500, "storage_error", "unable to read stored observation")
		return
	}
	if len(items) == 0 {
		failure(w, 404, "not_ingested", "no matching stored observation; ingest the slot first")
		return
	}
	if len(items) > 1 {
		roots := []string{}
		for _, o := range items {
			roots = append(roots, o.BlockRoot)
		}
		write(w, 409, ErrorResponse{Error: ErrorDetail{Code: "ambiguous_slot", Message: "multiple stored roots; select block_root explicitly", BlockRoots: roots}})
		return
	}
	write(w, 200, ObservationResponse{Data: items[0]})
}
func (s *Server) ingest(w http.ResponseWriter, r *http.Request) {
	slot, ok := s.parameters(w, r)
	if !ok {
		return
	}
	snapshot, err := s.Collector.Fetch(r.Context(), slot)
	if err != nil {
		switch {
		case errors.Is(err, ingest.ErrUnavailable):
			failure(w, 404, "slot_unavailable", ingest.ErrUnavailable.Error())
		case errors.Is(err, ingest.ErrUnsupported):
			failure(w, 422, "unsupported_block", ingest.ErrUnsupported.Error())
		case errors.Is(err, ingest.ErrMismatch):
			failure(w, 422, "identifier_mismatch", "upstream identifiers or network do not match")
		case errors.Is(err, context.DeadlineExceeded):
			failure(w, 504, "upstream_timeout", "slot ingestion timed out")
		case errors.Is(err, context.Canceled):
			return
		default:
			failure(w, 502, "upstream_error", "unable to fetch complete source data; retry later")
		}
		return
	}
	if err = s.Repository.Save(r.Context(), snapshot); err != nil {
		failure(w, 500, "storage_error", "unable to persist observation")
		return
	}
	if s.Watch != nil {
		if err = payloadwatch.RecordSnapshot(r.Context(), s.Watch, snapshot.Observation, s.SourceID, "live"); err != nil {
			failure(w, 500, "projection_error", "raw snapshot saved; retry to rebuild PayloadWatch projection")
			return
		}
		if err = s.Watch.Reconcile(r.Context(), s.Network, "live", s.SourceID, slot, snapshot.Observation.BlockRoot, time.Now().UTC()); err != nil {
			failure(w, 500, "projection_error", "unable to reconcile canonical roots")
			return
		}
	}
	write(w, 200, ObservationResponse{Data: snapshot.Observation})
}
