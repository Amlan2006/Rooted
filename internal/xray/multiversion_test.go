package xray

import (
	"fmt"
	"slices"
	"testing"

	"rooted/internal/bal"
	"rooted/internal/uniswap"
)

// tx0 reads a slot tx1 then writes (WAR only); tx2 reads tx0's write (RAW) and rewrites tx1's balance credit (WAW).
func TestMultiVersionBuilderDropsOnlyWAR(t *testing.T) {
	slot := bal.Location{Address: pool, Field: "storage", Key: h("1")}
	g := bal.Graph{Edges: []bal.Edge{{From: 0, To: 1, Kind: "WAR", Location: slot}, {From: 0, To: 2, Kind: "RAW", Location: slot}, {From: 1, To: 2, Kind: "WAW", Location: bal.Location{Address: bob, Field: "balance"}}, {From: 0, To: 2, Kind: "WAR", Location: slot}}}
	static, mv := predecessors(g, 3, false), predecessors(g, 3, true)
	if !slices.Equal(static[1], []int{0}) || !slices.Equal(static[2], []int{0, 1}) || len(mv[1]) != 0 || !slices.Equal(mv[2], []int{0, 1}) {
		t.Fatalf("static %v multi-version %v", static, mv)
	}
	ns := []int64{5, 5, 5}
	_, _, b := Ceilings(ns, []uint64{1, 1, 1}, static)
	_, _, m := Ceilings(ns, []uint64{1, 1, 1}, mv)
	if !near(*b.Value, 1) || !near(*m.Value, 1.5) {
		t.Fatalf("static %v multi-version %v", *b.Value, *m.Value)
	}
}

// A labelled location ranked below the top 10 must still be listed, or the dashboard hides Uniswap contention.
func TestHotLocationsKeepLabelledBelowTopTen(t *testing.T) {
	var g bal.Graph
	for a := 1; a <= 11; a++ {
		l := bal.Location{Address: fmt.Sprintf("0x%040x", 0x1000+a), Field: "storage", Key: h("0")}
		g.Edges = append(g.Edges, bal.Edge{From: 0, To: 1, Kind: "RAW", Location: l}, bal.Edge{From: 1, To: 2, Kind: "RAW", Location: l})
	}
	g.Edges = append(g.Edges, bal.Edge{From: 0, To: 2, Kind: "WAW", Location: bal.Location{Address: pool, Field: "storage", Key: h("0")}})
	r := Report{HotLocations: []Hot{}}
	hotEdges(&r, g, uniswap.BlockContext{V3Pools: map[string]bool{pool: true}})
	last := r.HotLocations[len(r.HotLocations)-1]
	if len(r.HotLocations) != 11 || last.Address != pool || last.Label == nil || r.Uniswap.LabeledEdges != 1 {
		t.Fatalf("hot locations %d, last %+v, labelled edges %d", len(r.HotLocations), last, r.Uniswap.LabeledEdges)
	}
}
