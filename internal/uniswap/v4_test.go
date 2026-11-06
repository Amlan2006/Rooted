package uniswap

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
)

const fixturePool = "0x2a4135ca6fc4144db6d96958880cb8dd0c12850fe9b6ec2346d589ad7ddd1c37"

// fixtureLogs flattens the real block 12075101 receipts (testdata/v4/README.md).
func fixtureLogs(t *testing.T) []Log {
	raw, err := os.ReadFile("testdata/v4/receipts-12075101.json")
	if err != nil {
		t.Fatal(err)
	}
	var receipts []struct {
		Logs []Log `json:"logs"`
	}
	if err = json.Unmarshal(raw, &receipts); err != nil {
		t.Fatal(err)
	}
	var logs []Log
	for _, r := range receipts {
		logs = append(logs, r.Logs...)
	}
	return logs
}

func TestPoolStateSlotGolden(t *testing.T) {
	// Spec §3: eth_getStorageAt here decodes to StateView.getSlot0 of this pool.
	s, err := PoolStateSlot("0xefd4fde4a8ac2e40092bd3c5025ef3869cfc2e4cff9b3cd900004ba06ab067f8")
	if err != nil || s != "0x36d62fe1e6ddebb25f553a4697be8bc2a98c079a1a2db5565b5fd8e4fa02421c" {
		t.Fatal(s, err)
	}
	if _, err = PoolStateSlot("0x1234"); err == nil {
		t.Fatal("short poolId accepted")
	}
}

func TestDecodeSwapV4RealLog(t *testing.T) {
	var log Log
	for _, l := range fixtureLogs(t) {
		if l.Topics[0] == SwapV4Topic {
			log = l
		}
	}
	swap, err := DecodeSwapV4(log)
	want := SwapV4{PoolID: fixturePool, Transaction: "0xb6f4c0ea756ed77611c42d00e05d78dc1f629c6c69a0c5f1fc6c7d4a7f5c7293", LogIndex: "0x1d", Sender: "0x85e23027ffe8321e4a13be3d64942dc9a7172e7a", Amount0: "2792946", Amount1: "-4066280", SqrtPrice: "95595183170433917336772035643", Liquidity: "0", Tick: 3756, Fee: 100}
	if err != nil || swap != want {
		t.Fatal(swap, err)
	}
	setWord := func(i int, w string) func(*Log) {
		return func(l *Log) { l.Data = l.Data[:2+64*i] + w + l.Data[2+64*(i+1):] }
	}
	for name, mutate := range map[string]func(*Log){
		"wrong address":     func(l *Log) { l.Address = Factory },
		"topic count":       func(l *Log) { l.Topics = l.Topics[:2] },
		"v3 topic":          func(l *Log) { l.Topics[0] = SwapTopic },
		"data length":       func(l *Log) { l.Data = l.Data[:len(l.Data)-64] },
		"removed":           func(l *Log) { l.Removed = true },
		"int128 overflow":   setWord(0, strings.Repeat("0", 32)+"8"+strings.Repeat("0", 31)), // 2^127
		"int24 tick range":  setWord(4, word(1<<23)),
		"uint24 fee range":  setWord(5, word(1<<24)),
		"short pool id":     func(l *Log) { l.Topics[1] = "0x01" },
		"dirty sender word": func(l *Log) { l.Topics[2] = "0x01" + l.Topics[2][4:] },
	} {
		bad := log
		bad.Topics = slices.Clone(log.Topics)
		mutate(&bad)
		if _, err := DecodeSwapV4(bad); err == nil {
			t.Fatal(name, "accepted")
		}
	}
}
