package config

import (
	"strings"
	"testing"
)

func defaults(t *testing.T) {
	t.Helper()
	for _, key := range []string{"ROOTED_NETWORK", "ROOTED_CHAIN_ID", "ROOTED_GENESIS_ROOT", "ROOTED_BEACON_URL", "ROOTED_EXECUTION_URL", "ROOTED_LISTEN_ADDR", "ROOTED_REQUEST_TIMEOUT", "ROOTED_WATCH_ENABLED", "ROOTED_STREAM_ENABLED", "ROOTED_SOURCE_ID", "ROOTED_POLL_INTERVAL", "ROOTED_POLL_LOOKBACK", "ROOTED_MAX_CATCHUP", "ROOTED_LOCAL_LATE_AFTER", "ROOTED_LOCAL_MISSING_AFTER", "ROOTED_PTC_SIZE", "ROOTED_PTC_QUORUM"} {
		t.Setenv(key, "")
	}
	t.Setenv("DATABASE_URL", "postgres://rooted:local@127.0.0.1:54329/rooted?sslmode=disable")
}

func TestDefaults(t *testing.T) {
	defaults(t)
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Network != "sepolia" || c.ChainID != "11155111" || c.ListenAddr != "127.0.0.1:8080" {
		t.Fatalf("unexpected defaults: %+v", c)
	}
}

func TestInvalidConfiguration(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"DATABASE_URL", ""},
		{"ROOTED_NETWORK", " "},
		{"ROOTED_CHAIN_ID", "0"},
		{"ROOTED_CHAIN_ID", "0xaa36a7"},
		{"ROOTED_CHAIN_ID", "011155111"},
		{"ROOTED_GENESIS_ROOT", "0x1234"},
		{"ROOTED_GENESIS_ROOT", "0x" + strings.Repeat("z", 64)},
		{"ROOTED_LISTEN_ADDR", "invalid"},
		{"ROOTED_LISTEN_ADDR", "127.0.0.1:70000"},
		{"ROOTED_BEACON_URL", "file:///secret"},
		{"ROOTED_EXECUTION_URL", "https://example.invalid/key#fragment"},
		{"ROOTED_REQUEST_TIMEOUT", "0s"},
	} {
		t.Run(tc.key+"/"+tc.value, func(t *testing.T) {
			defaults(t)
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatal("expected configuration error")
			}
		})
	}
}
