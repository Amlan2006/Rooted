package bal

import (
	"encoding/json"
	"testing"
)

const owner = "0x00000000000000000000000000000000000000aa"
const child = "0x00000000000000000000000000000000000000bb"

func TestTraceStorageContextAndRevertedReads(t *testing.T) {
	trace := OpcodeTrace{Failed: true, Logs: []Opcode{
		{Op: "SLOAD", Depth: 1, Stack: []string{"01"}},
		{Op: "DELEGATECALL", Depth: 1, Stack: []string{"bb", "ffff"}},
		{Op: "SSTORE", Depth: 2, Stack: []string{"09", "02"}},
		{Op: "REVERT", Depth: 2},
		{Op: "CALL", Depth: 1, Stack: []string{"bb", "ffff"}},
		{Op: "SLOAD", Depth: 2, Stack: []string{"03"}},
		{Op: "REVERT", Depth: 1},
	}}
	raw, _ := json.Marshal(trace)
	a := Access{}
	if err := AddOpcodes(&a, raw, owner, 100); err != nil {
		t.Fatal(err)
	}
	if !a.StorageReadsComplete || len(a.Reads) != 3 || len(a.Writes) != 0 {
		t.Fatalf("bad access %+v", a)
	}
	for i, want := range []string{owner, owner, child} {
		if a.Reads[i].Address != want {
			t.Fatalf("wrong storage context %+v", a.Reads)
		}
	}
	// An implicit SSTORE read survives a frame revert; writes require a committed diff.
	if a.Reads[1].Key[len(a.Reads[1].Key)-1:] != "2" {
		t.Fatal(a.Reads)
	}
}
func TestEmptyErroredLimitedAndCreationTrace(t *testing.T) {
	for _, trace := range []OpcodeTrace{
		{Logs: []Opcode{}},
		{Logs: []Opcode{{Op: "SLOAD", Depth: 1, Stack: []string{"01"}, Error: json.RawMessage(`"out of gas"`)}}},
		{Logs: []Opcode{{Op: "CREATE", Depth: 1}, {Op: "SLOAD", Depth: 2, Stack: []string{"01"}}}},
	} {
		raw, _ := json.Marshal(trace)
		a := Access{}
		if err := AddOpcodes(&a, raw, owner, 100); err != nil {
			t.Fatal(err)
		}
		if a.StorageReadsComplete || len(a.Reads) != 0 {
			t.Fatalf("invented access coverage %+v", a)
		}
	}
	a := Access{}
	if err := AddOpcodes(&a, json.RawMessage(`{"structLogs":[{"op":"SLOAD","depth":1,"stack":["01"]}]}`), owner, 1); err != nil || a.StorageReadsComplete {
		t.Fatal(a, err)
	}
}
func TestPrestateCandidatesAndCommittedDiff(t *testing.T) {
	a := Access{}
	if err := AddPrestate(&a, json.RawMessage(`{"`+owner+`":{"storage":{"0x01":"0x02"}}}`)); err != nil {
		t.Fatal(err)
	}
	if len(a.Reads) != 0 || len(a.Candidates) != 1 {
		t.Fatal(a)
	}
	raw := json.RawMessage(`{"pre":{"` + owner + `":{"balance":"0x20","nonce":1,"storage":{"0x01":"0x02"}}},"post":{"` + owner + `":{"balance":"0x10","nonce":2}}}`)
	if err := AddGethDiff(&a, raw); err != nil {
		t.Fatal(err)
	}
	if len(a.Writes) != 3 {
		t.Fatalf("balance nonce and deleted storage expected %+v", a)
	}
	b := Access{}
	if err := AddParityDiff(&b, json.RawMessage(`{"stateDiff":{"`+owner+`":{"balance":"=","nonce":{"*":{"from":"0x1","to":"0x2"}},"storage":{"0x01":"="}}}}`)); err != nil || len(b.Writes) != 1 || b.Writes[0].Field != "nonce" {
		t.Fatal(b, err)
	}
}
