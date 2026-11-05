package config

import (
	"fmt"
	"net/url"
)

// AnalysisConfig keeps trace and fork endpoints separate from the live
// execution/Beacon pair. Fork RPC is intentionally loopback-only.
type AnalysisConfig struct {
	TraceURL, ForkURL, AnchorNumber, AnchorHash string
}

func LoadAnalysis() (AnalysisConfig, error) {
	c := AnalysisConfig{
		AnchorNumber: env("ROOTED_ANALYSIS_ANCHOR_NUMBER", "0xf4240"),
		AnchorHash:   env("ROOTED_ANALYSIS_ANCHOR_HASH", "0xaad11ee5a3b4b037a4cef3afd30398bf8b0f73e702cf86f86e3f4eaa9d7d39a2"),
		TraceURL:     env("ROOTED_TRACE_URL", "https://sepolia.drpc.org"),
		ForkURL:      env("ROOTED_FORK_RPC", "http://127.0.0.1:8547"),
	}
	for _, endpoint := range []string{c.TraceURL, c.ForkURL} {
		u, err := url.Parse(endpoint)
		if err != nil || u.Hostname() == "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
			return c, fmt.Errorf("invalid analysis HTTP endpoint")
		}
	}
	u, _ := url.Parse(c.ForkURL)
	if u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
		return c, fmt.Errorf("fork analysis RPC must be on loopback")
	}
	return c, nil
}
