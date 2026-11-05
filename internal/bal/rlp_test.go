package bal

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestNativeRLPFromCapturedEnvelope(t *testing.T) {
	readBody := func(path string) []byte {
		t.Helper()
		raw, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		var record struct {
			Body string `json:"body"`
		}
		if e = json.Unmarshal(raw, &record); e != nil {
			t.Fatal(e)
		}
		return []byte(record.Body)
	}
	var envelope struct {
		Data struct {
			Message struct {
				Payload struct {
					BAL string `json:"block_access_list"`
				} `json:"payload"`
			} `json:"message"`
		} `json:"data"`
	}
	if e := json.Unmarshal(readBody("../ingest/testdata/matched_envelope.json"), &envelope); e != nil {
		t.Fatal(e)
	}
	var block struct {
		Result struct {
			Hash         string   `json:"blockAccessListHash"`
			Transactions []string `json:"transactions"`
		} `json:"result"`
	}
	if e := json.Unmarshal(readBody("../ingest/testdata/matched_execution_block.json"), &block); e != nil {
		t.Fatal(e)
	}
	result, e := DecodeNativeRLP(envelope.Data.Message.Payload.BAL, len(block.Result.Transactions), block.Result.Hash)
	if e != nil {
		t.Fatal(e)
	}
	if result.Accounts == 0 || result.CommitmentVerified == nil || !*result.CommitmentVerified {
		t.Fatal("missing verified BAL")
	}
}

func TestNativeRLPMatchesJSONAndRejectsCorruption(t *testing.T) {
	addr := make([]byte, 20)
	addr[19] = 1
	change := func(value []byte) []byte { return listRLP(listRLP(strRLP([]byte{1}), strRLP(value))) }
	encoded := listRLP(listRLP(strRLP(addr), listRLP(listRLP(strRLP(nil), change([]byte{2}))), listRLP(strRLP([]byte{3})), change([]byte{4}), change([]byte{5}), change([]byte{0, 0x60})))
	jsonBAL := `[{"address":"0x0000000000000000000000000000000000000001","storageChanges":[{"key":"0x0","changes":[{"index":"0x1","value":"0x2"}]}],"storageReads":["0x3"],"balanceChanges":[{"index":"0x1","value":"0x4"}],"nonceChanges":[{"index":"0x1","value":"0x5"}],"codeChanges":[{"index":"0x1","code":"0x0060"}]}]`
	expected, e := DecodeNative([]byte(jsonBAL), 1, Keccak(encoded))
	if e != nil {
		t.Fatal(e)
	}
	got, e := DecodeNativeRLP("0x"+hex.EncodeToString(encoded), 1, expected.ComputedHash)
	if e != nil {
		t.Fatal(e)
	}
	got.Schema = expected.Schema
	if !reflect.DeepEqual(got, expected) {
		t.Fatal("JSON/RLP semantics differ")
	}
	bad := []string{"", "0x", "0xzz", "0xc080", "0xf80180", "0xc181", "0xbfffffffffffffffff", "0xc600c0c0c0c0c0"}
	for _, value := range bad {
		if _, e := DecodeNativeRLP(value, 1, ""); e == nil {
			t.Fatalf("accepted malformed RLP %s", value)
		}
	}
	if _, e := DecodeNativeRLP("0x"+hex.EncodeToString(encoded), 1, "0x"+strings.Repeat("00", 32)); e == nil {
		t.Fatal("accepted wrong commitment")
	}
	// Leading-zero integers and transaction indexes outside the block are rejected.
	for _, index := range [][]byte{{0}, {2, 0}} {
		raw := listRLP(listRLP(strRLP(addr), listRLP(), listRLP(), listRLP(listRLP(strRLP(index), strRLP([]byte{1}))), listRLP(), listRLP()))
		if _, e := DecodeNativeRLP("0x"+hex.EncodeToString(raw), 1, ""); e == nil {
			t.Fatal("accepted invalid integer/index")
		}
	}
}
