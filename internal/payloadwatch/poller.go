package payloadwatch

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"time"

	"rooted/internal/domain"
	"rooted/internal/ingest"
	"rooted/internal/remote"
	"rooted/internal/storage"
)

type Poller struct {
	Engine               *Engine
	Collector            *ingest.Collector
	Repository           storage.Repository
	Beacon               remote.Beacon
	Network, SourceID    string
	Interval             time.Duration
	Lookback, MaxCatchup uint64
	Wake                 <-chan uint64
	Logger               *slog.Logger
}

func (p *Poller) Run(ctx context.Context) {
	ticker := time.NewTicker(p.Interval)
	defer ticker.Stop()
	for ctx.Err() == nil {
		if err := p.Poll(ctx); err != nil {
			_ = p.Engine.SetProgress(ctx, p.Network, p.SourceID, "poll", "error", nil)
			if p.Logger != nil {
				p.Logger.WarnContext(ctx, "slot poll failed; will retry", "error", err.Error())
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-p.Wake:
		}
	}
}
func (p *Poller) Poll(ctx context.Context) error {
	r, err := p.Beacon.Get(ctx, "/eth/v1/beacon/headers/head", "head_header")
	if err != nil {
		return err
	}
	var header struct {
		Data struct {
			Header struct {
				Message struct {
					Slot string `json:"slot"`
				} `json:"message"`
			} `json:"header"`
		} `json:"data"`
	}
	if err = json.Unmarshal(r.Body, &header); err != nil {
		return err
	}
	head, err := decimalSlot(header.Data.Header.Message.Slot)
	if err != nil {
		return err
	}
	progress, err := p.Engine.Progress(ctx, p.Network, p.SourceID)
	if err != nil {
		return err
	}
	start := uint64(0)
	if head > p.Lookback {
		start = head - p.Lookback
	}
	var cursor uint64
	hasCursor := progress.LastSlot != nil
	if hasCursor {
		cursor, err = decimalSlot(*progress.LastSlot)
		if err != nil {
			return err
		}
		if cursor > head {
			cursor = head
			hasCursor = false
		}
	}
	// Keep backfill bounded per pass while always revisiting recent slots for payloads/reorgs.
	set := map[uint64]bool{}
	if hasCursor {
		for i := uint64(1); i <= p.MaxCatchup && cursor+i <= head && cursor+i > cursor; i++ {
			set[cursor+i] = true
		}
	}
	for i := start; i <= head; i++ {
		set[i] = true
		if i == head {
			break
		}
	}
	slots := make([]uint64, 0, len(set))
	for slot := range set {
		slots = append(slots, slot)
	}
	sort.Slice(slots, func(i, j int) bool { return slots[i] < slots[j] })
	blocked := false
	for _, slot := range slots {
		fetchCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		snapshot, fetchErr := p.Collector.Fetch(fetchCtx, slot)
		cancel()
		if fetchErr != nil {
			if !errors.Is(fetchErr, ingest.ErrUnavailable) {
				return fetchErr
			}
			// A 404 is an unavailable observation, not a builder-missing verdict.
		} else {
			if err = p.Repository.Save(ctx, snapshot); err != nil {
				return err
			}
			if err = RecordSnapshot(ctx, p.Engine, snapshot.Observation, p.SourceID, "live"); err != nil {
				return err
			}
			if err = p.Engine.Reconcile(ctx, p.Network, "live", p.SourceID, slot, snapshot.Observation.BlockRoot, time.Now().UTC()); err != nil {
				return err
			}
		}
		if !hasCursor || slot == cursor+1 {
			if !blocked {
				cursor = slot
				hasCursor = true
				if err = p.Engine.SetProgress(ctx, p.Network, p.SourceID, "poll", "ok", &cursor); err != nil {
					return err
				}
			}
		} else if slot > cursor+1 {
			blocked = true
		}
	}
	return p.Engine.Refresh(ctx, p.Network, "live", p.SourceID, time.Now().UTC())
}

func RecordSnapshot(ctx context.Context, engine *Engine, o domain.Observation, source, mode string) error {
	_, _, err := engine.Apply(ctx, Event{Network: o.Network, Mode: mode, SourceID: source, Kind: "snapshot", Slot: o.Slot, Root: o.BlockRoot, ObservedAt: o.FetchedAt, Snapshot: &o})
	if err != nil {
		return err
	}
	// Included aggregates are attributed to their own slot/root, never the containing slot.
	var aggregates []struct {
		Bits string `json:"aggregation_bits"`
		Data struct {
			Slot    string `json:"slot"`
			Root    string `json:"beacon_block_root"`
			Present bool   `json:"payload_present"`
			Blobs   bool   `json:"blob_data_available"`
		} `json:"data"`
	}
	if err = json.Unmarshal(o.IncludedPTCAttestations, &aggregates); err != nil {
		return err
	}
	for _, a := range aggregates {
		slot, err := decimalSlot(a.Data.Slot)
		if err != nil {
			return err
		}
		raw, _ := json.Marshal(a)
		_, _, err = engine.Apply(ctx, Event{Network: o.Network, Mode: mode, SourceID: source, Kind: "ptc", Slot: slot, Root: a.Data.Root, ObservedAt: o.FetchedAt, Votes: &Votes{Bits: a.Bits, PayloadPresent: a.Data.Present, BlobAvailable: a.Data.Blobs}, Raw: raw})
		if err != nil {
			return err
		}
	}
	return nil
}
