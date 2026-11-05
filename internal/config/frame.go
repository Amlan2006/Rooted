package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// FrameConfig isolates the sponsor devnet from the primary Beacon/execution scope.
type FrameConfig struct {
	Enabled, Stream                             bool
	Network, Gateway, Miner, Execution, Genesis string
	Chain                                       uint64
	Poll, ObservationWindow                     time.Duration
}

func LoadFrame() (FrameConfig, error) {
	f := FrameConfig{Network: env("ROOTED_FRAME_NETWORK", "frame-devnet"),
		Gateway:   env("ROOTED_FRAME_GATEWAY_URL", "https://altmempoolgateway.forshtat.com/rpc"),
		Miner:     env("ROOTED_FRAME_MINER_URL", "https://altmempool.forshtat.com/rpc"),
		Execution: env("ROOTED_FRAME_EXECUTION_URL", "https://altmempool.forshtat.com"),
		Genesis:   env("ROOTED_FRAME_GENESIS_HASH", "0x196a1589ac71e2f305b1fbc7bfd23e55367f9fd6eb9da97e2f572c2791e17bbc")}
	var err error
	if f.Enabled, err = strconv.ParseBool(env("ROOTED_FRAME_ENABLED", "true")); err != nil {
		return f, fmt.Errorf("invalid frame enabled setting")
	}
	if f.Stream, err = strconv.ParseBool(env("ROOTED_FRAME_STREAM_ENABLED", "true")); err != nil {
		return f, fmt.Errorf("invalid frame stream setting")
	}
	if f.Chain, err = strconv.ParseUint(env("ROOTED_FRAME_CHAIN_ID", "1337"), 10, 64); err != nil || f.Chain == 0 {
		return f, fmt.Errorf("invalid frame chain ID")
	}
	if f.Poll, err = time.ParseDuration(env("ROOTED_FRAME_POLL_INTERVAL", "20s")); err != nil || f.Poll < time.Second {
		return f, fmt.Errorf("invalid frame poll interval")
	}
	if f.ObservationWindow, err = time.ParseDuration(env("ROOTED_FRAME_OBSERVATION_WINDOW", "2m")); err != nil || f.ObservationWindow <= 0 {
		return f, fmt.Errorf("invalid frame observation window")
	}
	if f.Network == "" || strings.TrimSpace(f.Network) != f.Network || f.Network == env("ROOTED_NETWORK", "sepolia") {
		return f, fmt.Errorf("frame network must have a distinct explicit identity")
	}
	if len(f.Genesis) != 66 || !strings.HasPrefix(f.Genesis, "0x") {
		return f, fmt.Errorf("invalid frame genesis hash")
	}
	for _, v := range f.Genesis[2:] {
		if !(v >= '0' && v <= '9' || v >= 'a' && v <= 'f' || v >= 'A' && v <= 'F') {
			return f, fmt.Errorf("invalid frame genesis hash")
		}
	}
	for _, endpoint := range []string{f.Gateway, f.Miner, f.Execution} {
		u, e := url.Parse(endpoint)
		if e != nil || u.Hostname() == "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
			return f, fmt.Errorf("invalid frame HTTP endpoint")
		}
	}
	return f, nil
}
