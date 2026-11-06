package bal

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// testdata/sample_N_block.json are eth_getBlockByHash captures; sample_N_bal.json
// are eth_getBlockAccessList captures for the same block (see testdata/README.md).
func captured(t *testing.T, name string, target any) {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(b, target); err != nil {
		t.Fatal(err)
	}
}
func TestNativeCommitmentFromActualBlocks(t *testing.T) {
	for _, sample := range []string{"sample_0", "sample_1", "sample_2", "sample_3"} {
		t.Run(sample, func(t *testing.T) {
			var wrapper struct {
				Body string `json:"body"`
			}
			captured(t, sample+"_block", &wrapper)
			var b struct {
				Result struct {
					Hash         string   `json:"hash"`
					Commitment   string   `json:"blockAccessListHash"`
					Transactions []string `json:"transactions"`
				} `json:"result"`
			}
			if err := json.Unmarshal([]byte(wrapper.Body), &b); err != nil {
				t.Fatal(err)
			}
			var balWrapper struct {
				Request struct {
					Params []string `json:"params"`
				} `json:"request"`
				Body string `json:"body"`
			}
			captured(t, sample+"_bal", &balWrapper)
			var bal struct {
				Result json.RawMessage `json:"result"`
			}
			if err := json.Unmarshal([]byte(balWrapper.Body), &bal); err != nil {
				t.Fatal(err)
			}
			if len(balWrapper.Request.Params) != 1 || balWrapper.Request.Params[0] != b.Result.Hash || b.Result.Commitment == "" {
				t.Fatal("captured BAL is not bound to the captured block")
			}
			n, err := DecodeNative(bal.Result, len(b.Result.Transactions), b.Result.Commitment)
			if err != nil {
				t.Fatalf("%s computed=%s expected=%s: %v", sample, n.ComputedHash, b.Result.Commitment, err)
			}
			if n.CommitmentVerified == nil || !*n.CommitmentVerified || n.Accounts == 0 {
				t.Fatal("native commitment not verified")
			}
		})
	}
}
func TestCanonicalConstraints(t *testing.T) {
	a := Account{Address: "0x" + strings.Repeat("1", 40), Storage: []Slot{{Key: "0x0", Changes: []RPCChange{{Index: "0x1", Value: "0x2"}}}}, Reads: []string{"0x0"}}
	b, _ := json.Marshal([]Account{a})
	if _, err := DecodeNative(b, 1, ""); err == nil {
		t.Fatal("overlapping read/write key accepted")
	}
	a.Reads = nil
	a.Storage[0].Changes[0].Index = "0x3"
	b, _ = json.Marshal([]Account{a})
	if _, err := DecodeNative(b, 1, ""); err == nil {
		t.Fatal("out-of-range index accepted")
	}
	n, err := DecodeNative(json.RawMessage(`[]`), 0, "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347")
	if err != nil || n.Accounts != 0 {
		t.Fatal("empty RLP commitment", err)
	}
}
func TestGraphDependencies(t *testing.T) {
	x := Location{Address: "pool", Field: "storage", Key: "slot"}
	y := Location{Address: "pool", Field: "storage", Key: "other"}
	tests := []struct {
		name   string
		access []Access
		kind   string
		count  int
	}{{"read read", []Access{{Index: 0, Reads: []Location{x}}, {Index: 1, Reads: []Location{x}}}, "", 0}, {"RAW", []Access{{Index: 0, Writes: []Location{x}}, {Index: 1, Reads: []Location{x}}}, "RAW", 1}, {"WAR", []Access{{Index: 0, Reads: []Location{x}}, {Index: 1, Writes: []Location{x}}}, "WAR", 1}, {"WAW", []Access{{Index: 0, Writes: []Location{x}}, {Index: 1, Writes: []Location{x}}}, "WAW", 1}, {"same contract different slot", []Access{{Index: 0, Writes: []Location{x}}, {Index: 1, Writes: []Location{y}}}, "", 0}}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := BuildGraph(tt.access, false, 100)
			if len(g.Edges) != tt.count {
				t.Fatalf("edges %+v", g.Edges)
			}
			if tt.count > 0 && g.Edges[0].Kind != tt.kind {
				t.Fatal("wrong dependency")
			}
			if g.Complete || g.TheoreticalSpeedup != nil {
				t.Fatal("partial graph claimed complete")
			}
		})
	}
	g := BuildGraph([]Access{{Index: 0, Writes: []Location{x}}, {Index: 1, Reads: []Location{x}, Writes: []Location{y}}, {Index: 2, Reads: []Location{y}}}, false, 100)
	if g.Depth != 3 || g.Width != 1 {
		t.Fatalf("wrong chain metrics %+v", g)
	}
	g = BuildGraph([]Access{{Index: 0, Writes: []Location{x}}, {Index: 1, Writes: []Location{x}}, {Index: 2, Writes: []Location{x}}}, false, 1)
	if !g.Truncated {
		t.Fatal("edge cap not disclosed")
	}
}

func TestIndexedPhasesAndCommitmentMismatch(t *testing.T) {
	a := Account{Address: "0x" + strings.Repeat("1", 40), Balance: []RPCChange{{Index: "0x0", Value: "0x1"}, {Index: "0x2", Value: "0x3"}}, Nonce: []RPCChange{{Index: "0x1", Value: "0x1"}}, Code: []CodeChange{{Index: "0x1", Code: "0x6000"}}}
	raw, _ := json.Marshal([]Account{a})
	n, err := DecodeNative(raw, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	pre, post, tx := 0, 0, 0
	for _, change := range n.Changes {
		switch change.Phase {
		case "pre_execution":
			pre++
			if change.TransactionIndex != nil {
				t.Fatal(change)
			}
		case "post_execution":
			post++
			if change.TransactionIndex != nil {
				t.Fatal(change)
			}
		case "transaction":
			tx++
			if change.TransactionIndex == nil || *change.TransactionIndex != 0 {
				t.Fatal(change)
			}
		}
	}
	if pre != 1 || post != 1 || tx != 2 {
		t.Fatal(n)
	}
	access := NativeAccess(n, []string{"transaction"})
	if len(access[0].Writes) != 2 {
		t.Fatal("pre/post writes assigned to transaction")
	}
	if _, err = DecodeNative(raw, 1, "0x"+strings.Repeat("0", 64)); err == nil {
		t.Fatal("wrong header commitment accepted")
	}
}
