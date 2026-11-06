package main

import (
	"strings"
	"testing"
)

func TestCommandArguments(t *testing.T) {
	for _, tc := range []struct {
		args    []string
		command string
		slot    uint64
		invalid bool
	}{
		{nil, "serve", 0, false},
		{[]string{"migrate"}, "migrate", 0, false},
		{[]string{"--help"}, "help", 0, false},
		{[]string{"compare-providers"}, "compare-providers", 0, false},
		{[]string{"compare-providers", "0x" + strings.Repeat("a", 64)}, "compare-providers", 0, false},
		{[]string{"compare-providers", "latest"}, "", 0, true},
		{[]string{"profile", "0x" + strings.Repeat("b", 64)}, "profile", 0, false},
		{[]string{"profile-replay", "0x" + strings.Repeat("c", 64)}, "profile-replay", 0, false},
		{[]string{"profile-capture", "0x" + strings.Repeat("c", 64)}, "profile-capture", 0, false},
		{[]string{"profile", "latest"}, "", 0, true},
		{[]string{"profile-replay"}, "", 0, true},
		{[]string{"profile-capture", "bad"}, "", 0, true},
		{[]string{"replay", "dataset.json"}, "replay", 0, false},
		{[]string{"replay"}, "", 0, true},
		{[]string{"replay", "dataset.json", "extra"}, "", 0, true},
		{[]string{"frame-sync"}, "frame-sync", 0, false},
		{[]string{"frame-sync", "miner", "0x" + strings.Repeat("a", 64)}, "frame-sync", 0, false},
		{[]string{"frame-sync", "unknown"}, "", 0, true},
		{[]string{"frame-sync", "gateway", "invalid"}, "", 0, true},
		{[]string{"frame-submit", "signed.json", "0x" + strings.Repeat("a", 64)}, "frame-submit", 0, false},
		{[]string{"frame-submit", "signed.json", "0x" + strings.Repeat("a", 64), "miner"}, "frame-submit", 0, false},
		{[]string{"frame-submit", "signed.json", "invalid"}, "", 0, true},
		{[]string{"frame-submit", "signed.json", "0x" + strings.Repeat("a", 64), "unknown"}, "", 0, true},
		{[]string{"analyze", "0x" + strings.Repeat("b", 64)}, "analyze", 0, false},
		{[]string{"analyze-fork", "0x" + strings.Repeat("b", 64), "0x" + strings.Repeat("c", 64)}, "analyze-fork", 0, false},
		{[]string{"analyze", "invalid"}, "", 0, true},
		{[]string{"analyze", "0x" + strings.Repeat("b", 64), "0x" + strings.Repeat("c", 64) + ",0x" + strings.Repeat("c", 64)}, "", 0, true},
		{[]string{"ingest", "11518268"}, "ingest", 11518268, false},
		{[]string{"ingest", "18446744073709551615"}, "ingest", ^uint64(0), false},
		{[]string{"ingest"}, "", 0, true},
		{[]string{"ingest", "-1"}, "", 0, true},
		{[]string{"ingest", "18446744073709551616"}, "", 0, true},
		{[]string{"ingest", "1", "extra"}, "", 0, true},
		{[]string{"serve", "extra"}, "", 0, true},
		{[]string{"unknown"}, "", 0, true},
	} {
		command, slot, err := parseArguments(tc.args)
		if (err != nil) != tc.invalid || command != tc.command || slot != tc.slot {
			t.Errorf("%v: got (%q,%d,%v)", tc.args, command, slot, err)
		}
	}
}
