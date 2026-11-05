package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

func loadWatch(c *Config) error {
	c.SourceID = env("ROOTED_SOURCE_ID", "beacon")
	if len(c.SourceID) > 100 || strings.TrimSpace(c.SourceID) != c.SourceID || c.SourceID == "" {
		return fmt.Errorf("source ID must contain 1..100 characters without surrounding whitespace")
	}
	for key, target := range map[string]*bool{"ROOTED_WATCH_ENABLED": &c.WatchEnabled, "ROOTED_STREAM_ENABLED": &c.StreamEnabled} {
		value, err := strconv.ParseBool(env(key, "true"))
		if err != nil {
			return fmt.Errorf("invalid %s", key)
		}
		*target = value
	}
	for _, item := range []struct {
		key, fallback string
		target        *time.Duration
	}{
		{"ROOTED_POLL_INTERVAL", "12s", &c.PollInterval},
		{"ROOTED_LOCAL_LATE_AFTER", "2s", &c.LateAfter},
		{"ROOTED_LOCAL_MISSING_AFTER", "8s", &c.MissingAfter},
	} {
		value, err := time.ParseDuration(env(item.key, item.fallback))
		if err != nil || value <= 0 {
			return fmt.Errorf("invalid %s", item.key)
		}
		*item.target = value
	}
	if c.PollInterval < time.Second || c.MissingAfter < c.LateAfter {
		return fmt.Errorf("poll interval must be >=1s and missing threshold >= late threshold")
	}
	for _, item := range []struct {
		key, fallback string
		target        *uint64
	}{
		{"ROOTED_POLL_LOOKBACK", "2", &c.Lookback},
		{"ROOTED_MAX_CATCHUP", "4", &c.MaxCatchup},
	} {
		value, err := strconv.ParseUint(env(item.key, item.fallback), 10, 64)
		if err != nil || value == 0 || value > 64 {
			return fmt.Errorf("invalid %s", item.key)
		}
		*item.target = value
	}
	for _, item := range []struct {
		key, fallback string
		target        *int
	}{
		{"ROOTED_PTC_SIZE", "512", &c.PTCSize},
		{"ROOTED_PTC_QUORUM", "0", &c.PTCQuorum},
	} {
		value, err := strconv.Atoi(env(item.key, item.fallback))
		if err != nil {
			return fmt.Errorf("invalid %s", item.key)
		}
		*item.target = value
	}
	if c.PTCSize <= 0 || c.PTCSize > 8192 || c.PTCSize%8 != 0 || c.PTCQuorum < 0 || c.PTCQuorum > c.PTCSize {
		return fmt.Errorf("invalid PTC committee size or quorum")
	}
	return nil
}
