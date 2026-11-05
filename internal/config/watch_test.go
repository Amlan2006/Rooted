package config

import (
	"strings"
	"testing"
	"time"
)

func TestWatchDefaultsKeepQuorumDisabled(t *testing.T) {
	defaults(t)
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !c.WatchEnabled || !c.StreamEnabled || c.SourceID != "beacon" || c.PollInterval != 12*time.Second || c.Lookback != 2 || c.MaxCatchup != 4 || c.PTCQuorum != 0 || c.PTCSize != 512 {
		t.Fatalf("unexpected collector defaults: %+v", c)
	}
}

func TestWatchConfigurationBoundaries(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"ROOTED_SOURCE_ID", " "}, {"ROOTED_SOURCE_ID", strings.Repeat("x", 101)},
		{"ROOTED_WATCH_ENABLED", "invalid"}, {"ROOTED_STREAM_ENABLED", "invalid"},
		{"ROOTED_POLL_INTERVAL", "100ms"}, {"ROOTED_POLL_INTERVAL", "-1s"},
		{"ROOTED_POLL_LOOKBACK", "0"}, {"ROOTED_POLL_LOOKBACK", "65"},
		{"ROOTED_MAX_CATCHUP", "0"}, {"ROOTED_MAX_CATCHUP", "65"},
		{"ROOTED_LOCAL_LATE_AFTER", "9s"}, {"ROOTED_LOCAL_MISSING_AFTER", "0s"},
		{"ROOTED_PTC_SIZE", "7"}, {"ROOTED_PTC_SIZE", "8200"},
		{"ROOTED_PTC_QUORUM", "-1"}, {"ROOTED_PTC_QUORUM", "513"},
	} {
		t.Run(tc.key+"/"+tc.value, func(t *testing.T) {
			defaults(t)
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatal("invalid collector configuration accepted")
			}
		})
	}
}

func TestWatchAndStreamCanBeDisabledIndependently(t *testing.T) {
	defaults(t)
	t.Setenv("ROOTED_STREAM_ENABLED", "false")
	c, err := Load()
	if err != nil || c.StreamEnabled || !c.WatchEnabled {
		t.Fatalf("stream-only disable failed: %+v %v", c, err)
	}
	t.Setenv("ROOTED_WATCH_ENABLED", "false")
	c, err = Load()
	if err != nil || c.WatchEnabled {
		t.Fatalf("collector disable failed: %+v %v", c, err)
	}
}
