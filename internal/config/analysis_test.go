package config

import "testing"

func TestAnalysisDefaultsAndLoopback(t *testing.T) {
	for _, key := range []string{"ROOTED_ANALYSIS_ANCHOR_NUMBER", "ROOTED_ANALYSIS_ANCHOR_HASH", "ROOTED_TRACE_URL", "ROOTED_FORK_RPC"} {
		t.Setenv(key, "")
	}
	c, err := LoadAnalysis()
	if err != nil || c.ForkURL != "http://127.0.0.1:8547" || c.AnchorNumber != "0xf4240" {
		t.Fatalf("unexpected defaults: %+v %v", c, err)
	}
	for _, value := range []string{"https://remote.invalid", "file:///tmp/fork", "http://127.0.0.1:8547#fragment"} {
		t.Setenv("ROOTED_FORK_RPC", value)
		if _, err := LoadAnalysis(); err == nil {
			t.Fatalf("accepted unsafe fork URL %q", value)
		}
	}
}
