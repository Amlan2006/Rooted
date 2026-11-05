package config

import (
	"strings"
	"testing"
	"time"
)

func frameDefaults(t *testing.T) {
	t.Helper()
	for _, key := range []string{"ROOTED_FRAME_ENABLED", "ROOTED_FRAME_STREAM_ENABLED", "ROOTED_FRAME_NETWORK", "ROOTED_FRAME_CHAIN_ID", "ROOTED_FRAME_GENESIS_HASH", "ROOTED_FRAME_GATEWAY_URL", "ROOTED_FRAME_MINER_URL", "ROOTED_FRAME_EXECUTION_URL", "ROOTED_FRAME_POLL_INTERVAL", "ROOTED_FRAME_OBSERVATION_WINDOW", "ROOTED_NETWORK"} {
		t.Setenv(key, "")
	}
}

func TestFrameDefaultsAndDisable(t *testing.T) {
	frameDefaults(t)
	f, err := LoadFrame()
	if err != nil || !f.Enabled || !f.Stream || f.Network != "frame-devnet" || f.Chain != 1337 || f.Poll != 20*time.Second || f.ObservationWindow != 2*time.Minute {
		t.Fatalf("invalid defaults: %+v %v", f, err)
	}
	t.Setenv("ROOTED_FRAME_ENABLED", "false")
	t.Setenv("ROOTED_FRAME_STREAM_ENABLED", "false")
	f, err = LoadFrame()
	if err != nil || f.Enabled || f.Stream {
		t.Fatalf("disable failed: %+v %v", f, err)
	}
}

func TestFrameConfigurationRejectsInvalidIdentity(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"ROOTED_FRAME_NETWORK", "sepolia"}, {"ROOTED_FRAME_NETWORK", " "},
		{"ROOTED_FRAME_CHAIN_ID", "0"}, {"ROOTED_FRAME_CHAIN_ID", "0x539"},
		{"ROOTED_FRAME_ENABLED", "invalid"}, {"ROOTED_FRAME_STREAM_ENABLED", "invalid"},
		{"ROOTED_FRAME_POLL_INTERVAL", "100ms"}, {"ROOTED_FRAME_OBSERVATION_WINDOW", "0s"},
		{"ROOTED_FRAME_GENESIS_HASH", "0x1"}, {"ROOTED_FRAME_GENESIS_HASH", "0x" + strings.Repeat("z", 64)},
		{"ROOTED_FRAME_GATEWAY_URL", "file:///private"}, {"ROOTED_FRAME_MINER_URL", "wss://example.invalid"},
		{"ROOTED_FRAME_EXECUTION_URL", "https://example.invalid/key#fragment"},
	} {
		t.Run(tc.key+tc.value, func(t *testing.T) {
			frameDefaults(t)
			t.Setenv(tc.key, tc.value)
			if _, err := LoadFrame(); err == nil {
				t.Fatal("invalid configuration accepted")
			}
		})
	}
}
