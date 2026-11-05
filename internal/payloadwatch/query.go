package payloadwatch

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type JournalEntry struct {
	Sequence int64 `json:"sequence"`
	Event    Event `json:"event"`
}

func (p *Engine) Events(ctx context.Context, network, mode, source string, after int64, slot *uint64, limit int) ([]JournalEntry, error) {
	var slotValue any
	if slot != nil {
		slotValue = strconv.FormatUint(*slot, 10)
	}
	rows, err := p.Pool.Query(ctx, `SELECT seq,event FROM pw_events WHERE network=$1 AND mode=$2 AND source_id=$3 AND seq>$4 AND ($5::numeric IS NULL OR slot=$5) ORDER BY seq LIMIT $6`, network, mode, source, after, slotValue, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []JournalEntry{}
	for rows.Next() {
		var e JournalEntry
		var raw []byte
		if err = rows.Scan(&e.Sequence, &raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &e.Event); err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	return result, rows.Err()
}
func (p *Engine) Builders(ctx context.Context, network, mode, source, builder string, since time.Time) ([]BuilderStats, error) {
	rows, err := p.Pool.Query(ctx, `SELECT builder_index,count(*),
count(*) FILTER (WHERE (state->>'payload_retrieved')::boolean),
count(*) FILTER (WHERE state->>'delivery'='late'),count(*) FILTER (WHERE state->>'delivery'='missing'),
count(*) FILTER (WHERE state->>'status'='failed'),count(*) FILTER (WHERE state->>'status'='healthy'),
count(*) FILTER (WHERE state->>'status'='pending'),count(*) FILTER (WHERE state->>'reveal_latency_ms' IS NOT NULL),
percentile_cont(0.5) WITHIN GROUP(ORDER BY (state->>'reveal_latency_ms')::double precision),
percentile_cont(0.95) WITHIN GROUP(ORDER BY (state->>'reveal_latency_ms')::double precision),
percentile_cont(0.99) WITHIN GROUP(ORDER BY (state->>'reveal_latency_ms')::double precision)
FROM pw_states WHERE network=$1 AND mode=$2 AND source_id=$3 AND canonical IS TRUE AND builder_index IS NOT NULL
AND ($4='' OR builder_index=$4) AND (state->>'first_observed_at')::timestamptz >= $5
GROUP BY builder_index ORDER BY count(*) DESC,builder_index`, network, mode, source, builder, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BuilderStats{}
	for rows.Next() {
		var b BuilderStats
		if err = rows.Scan(&b.Builder, &b.Observations, &b.Revealed, &b.Late, &b.Missing, &b.Failed, &b.Healthy, &b.Unknown, &b.Timed, &b.P50, &b.P95, &b.P99); err != nil {
			return nil, err
		}
		b.SelfBuild = b.Builder == "18446744073709551615"
		if b.Observations > 0 {
			reveals := float64(b.Revealed) / float64(b.Observations)
			healthy := float64(b.Healthy) / float64(b.Observations)
			b.RevealRatio = &reveals
			b.HealthyRatio = &healthy
		}
		result = append(result, b)
	}
	return result, rows.Err()
}

type Alert struct {
	Slot          string     `json:"slot"`
	Root          string     `json:"block_root"`
	Code          string     `json:"code"`
	FirstDetected time.Time  `json:"first_detected_at"`
	Active        bool       `json:"active"`
	ResolvedAt    *time.Time `json:"resolved_at"`
}

func (p *Engine) Alerts(ctx context.Context, network, mode, source string, limit int) ([]Alert, error) {
	rows, err := p.Pool.Query(ctx, `SELECT slot::text,block_root,code,first_detected_at,active,resolved_at FROM pw_alerts WHERE network=$1 AND mode=$2 AND source_id=$3 ORDER BY first_detected_at DESC,slot DESC,code LIMIT $4`, network, mode, source, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Alert{}
	for rows.Next() {
		var a Alert
		if err = rows.Scan(&a.Slot, &a.Root, &a.Code, &a.FirstDetected, &a.Active, &a.ResolvedAt); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}

// Metrics exposes durable observation counters (including later orphaned roots),
// and canonical-state gauges. Historical and synthetic modes are separately scoped.
func (p *Engine) Metrics(ctx context.Context, network, mode, source string) (string, error) {
	labels := fmt.Sprintf("network=%s,mode=%s,source=%s", strconv.Quote(network), strconv.Quote(mode), strconv.Quote(source))
	var out strings.Builder
	rows, err := p.Pool.Query(ctx, `SELECT outcome,count(*) FROM pw_outcomes WHERE network=$1 AND mode=$2 AND source_id=$3 GROUP BY outcome`, network, mode, source)
	if err != nil {
		return "", err
	}
	counts := map[string]int64{}
	for rows.Next() {
		var key string
		var count int64
		if err = rows.Scan(&key, &count); err != nil {
			rows.Close()
			return "", err
		}
		counts[key] = count
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", err
	}
	for _, item := range []struct{ name, key string }{
		{"rooted_payload_observed_total", "payload_observed"}, {"rooted_payload_missing_total", "local_missing_payload"},
		{"rooted_payload_late_total", "local_late_payload"}, {"rooted_payload_invalid_total", "execution_invalid"},
		{"rooted_payload_mismatch_total", "payload_mismatch"}, {"rooted_ptc_timely_total", "ptc_positive_payload_vote"},
		{"rooted_ptc_late_total", "ptc_negative_payload_vote"}, {"rooted_blob_unavailable_total", "blob_unavailable"},
	} {
		fmt.Fprintf(&out, "# HELP %s Unique roots ever observed with this outcome, including later orphaned roots.\n# TYPE %s counter\n%s{%s} %d\n", item.name, item.name, item.name, labels, counts[item.key])
	}
	buckets := []int64{100, 250, 500, 1000, 2000, 4000, 8000, 16000}
	var count int64
	var sum float64
	// Read every bucket/count/sum from one MVCC snapshot so concurrent inserts
	// cannot produce impossible histograms.
	var cumulative []int64
	err = p.Pool.QueryRow(ctx, `SELECT count(*),COALESCE(sum(latency_ms),0)::double precision,
    ARRAY[count(*) FILTER(WHERE latency_ms<=100),count(*) FILTER(WHERE latency_ms<=250),
    count(*) FILTER(WHERE latency_ms<=500),count(*) FILTER(WHERE latency_ms<=1000),
    count(*) FILTER(WHERE latency_ms<=2000),count(*) FILTER(WHERE latency_ms<=4000),
    count(*) FILTER(WHERE latency_ms<=8000),count(*) FILTER(WHERE latency_ms<=16000)]
    FROM pw_latency_samples WHERE network=$1 AND mode=$2 AND source_id=$3`, network, mode, source).Scan(&count, &sum, &cumulative)
	if err != nil {
		return "", err
	}
	out.WriteString("# HELP rooted_payload_reveal_latency_ms First comparable stream-receipt latency per root, milliseconds.\n# TYPE rooted_payload_reveal_latency_ms histogram\n")
	for i, bucket := range buckets {
		fmt.Fprintf(&out, "rooted_payload_reveal_latency_ms_bucket{%s,le=\"%d\"} %d\n", labels, bucket, cumulative[i])
	}
	fmt.Fprintf(&out, "rooted_payload_reveal_latency_ms_bucket{%s,le=\"+Inf\"} %d\nrooted_payload_reveal_latency_ms_count{%s} %d\nrooted_payload_reveal_latency_ms_sum{%s} %g\n", labels, count, labels, count, labels, sum)
	progress, err := p.Progress(ctx, network, source)
	if err != nil {
		return "", err
	}
	up := 0
	if progress.StreamStatus == "connected" {
		up = 1
	}
	fmt.Fprintf(&out, "# TYPE rooted_event_stream_connected gauge\nrooted_event_stream_connected{%s} %d\n", labels, up)
	var states, unknown int64
	err = p.Pool.QueryRow(ctx, `SELECT count(*),count(*) FILTER (WHERE state->>'reveal_latency_ms' IS NULL) FROM pw_states WHERE network=$1 AND mode=$2 AND source_id=$3 AND canonical IS TRUE AND builder_index IS NOT NULL`, network, mode, source).Scan(&states, &unknown)
	if err != nil {
		return "", err
	}
	fmt.Fprintf(&out, "# TYPE rooted_canonical_observations gauge\nrooted_canonical_observations{%s} %d\n# TYPE rooted_unknown_latency_observations gauge\nrooted_unknown_latency_observations{%s} %d\n", labels, states, labels, unknown)
	return out.String(), nil
}
