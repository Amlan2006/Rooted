package bal

import (
	"sort"
)

// BuildGraph reports exact overlaps of the supplied evidence. Coverage never
// becomes complete merely because no conflict was observed.
func BuildGraph(access []Access, storageOnly bool, maxEdges int) Graph {
	g := Graph{ConflictCounts: map[string]int{"RAW": 0, "WAR": 0, "WAW": 0}, Edges: []Edge{}, Hotspots: []Hotspot{}, Layers: [][]uint64{}, Transactions: len(access), Coverage: []string{"observed_evidence_graph_not_a_complete_execution_schedule", "account_existence_authorization_and_client_semantics_not_fully_modeled"}, StorageComplete: len(access) > 0}
	if maxEdges <= 0 {
		maxEdges = 100000
	}
	byIndex := map[uint64]bool{}
	for _, a := range access {
		byIndex[a.Index] = true
		if !a.StorageReadsComplete {
			g.StorageComplete = false
		}
	}
	type users struct {
		loc           Location
		reads, writes map[uint64]bool
	}
	locations := map[string]*users{}
	for _, a := range access {
		for kind, list := range map[string][]Location{"read": a.Reads, "write": a.Writes} {
			for _, l := range list {
				if storageOnly && l.Field != "storage" {
					continue
				}
				u := locations[l.ID()]
				if u == nil {
					u = &users{loc: l, reads: map[uint64]bool{}, writes: map[uint64]bool{}}
					locations[l.ID()] = u
				}
				if kind == "read" {
					u.reads[a.Index] = true
				} else {
					u.writes[a.Index] = true
				}
			}
		}
	}
	keys := []string{}
	for key := range locations {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	adjacency := map[uint64]map[uint64]bool{}
	for _, key := range keys {
		u := locations[key]
		g.Hotspots = append(g.Hotspots, Hotspot{Location: u.loc, Readers: len(u.reads), Writers: len(u.writes)})
		add := func(from, to uint64, kind string) {
			if from >= to {
				return
			}
			if len(g.Edges) >= maxEdges {
				g.Truncated = true
				return
			}
			g.ConflictCounts[kind]++
			g.Edges = append(g.Edges, Edge{From: from, To: to, Kind: kind, Location: u.loc, Basis: "attributed_read_and_committed_change_evidence"})
			if adjacency[to] == nil {
				adjacency[to] = map[uint64]bool{}
			}
			adjacency[to][from] = true
		}
		writers := []uint64{}
		readers := []uint64{}
		for i := range u.writes {
			writers = append(writers, i)
		}
		for i := range u.reads {
			readers = append(readers, i)
		}
		sort.Slice(writers, func(i, j int) bool { return writers[i] < writers[j] })
		sort.Slice(readers, func(i, j int) bool { return readers[i] < readers[j] })
		for i, w := range writers {
			for _, next := range writers[i+1:] {
				add(w, next, "WAW")
			}
			for _, r := range readers {
				if w < r {
					add(w, r, "RAW")
				} else if r < w {
					add(r, w, "WAR")
				}
			}
		}
	}
	sort.Slice(g.Edges, func(i, j int) bool {
		a, b := g.Edges[i], g.Edges[j]
		if a.From != b.From {
			return a.From < b.From
		}
		if a.To != b.To {
			return a.To < b.To
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return a.Location.ID() < b.Location.ID()
	})
	indices := []uint64{}
	for i := range byIndex {
		indices = append(indices, i)
	}
	sort.Slice(indices, func(i, j int) bool { return indices[i] < indices[j] })
	levels := map[uint64]int{}
	for _, i := range indices {
		level := 0
		for p := range adjacency[i] {
			if levels[p]+1 > level {
				level = levels[p] + 1
			}
		}
		levels[i] = level
		for len(g.Layers) <= level {
			g.Layers = append(g.Layers, []uint64{})
		}
		g.Layers[level] = append(g.Layers[level], i)
	}
	g.Depth = len(g.Layers)
	for _, layer := range g.Layers {
		if len(layer) > g.Width {
			g.Width = len(layer)
		}
	}
	sort.Slice(g.Hotspots, func(i, j int) bool {
		a, b := g.Hotspots[i], g.Hotspots[j]
		if a.Writers != b.Writers {
			return a.Writers > b.Writers
		}
		return a.Location.ID() < b.Location.ID()
	})
	if storageOnly {
		g.Coverage = append(g.Coverage, "storage_projection_excludes_balance_nonce_code_and_fee_recipient_dependencies")
	}
	if g.Truncated {
		g.Coverage = append(g.Coverage, "edge_limit_reached_metrics_are_for_truncated_graph")
	}
	// No speedup estimate is supplied without full semantic coverage/benchmarking.
	return g
}
