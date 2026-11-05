package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Network, ChainID, GenesisRoot, BeaconURL, ExecutionURL, DatabaseURL, ListenAddr string
	RequestTimeout                                                                  time.Duration
}

func Load() (Config, error) {
	c := Config{
		Network:      env("ROOTED_NETWORK", "sepolia"),
		ChainID:      env("ROOTED_CHAIN_ID", "11155111"),
		GenesisRoot:  env("ROOTED_GENESIS_ROOT", "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078"),
		BeaconURL:    env("ROOTED_BEACON_URL", "https://ethereum-sepolia-beacon-api.publicnode.com"),
		ExecutionURL: env("ROOTED_EXECUTION_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		ListenAddr:   env("ROOTED_LISTEN_ADDR", "127.0.0.1:8080"),
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if strings.TrimSpace(c.Network) == "" || strings.TrimSpace(c.Network) != c.Network {
		return c, fmt.Errorf("network is required")
	}
	if chain, err := strconv.ParseUint(c.ChainID, 10, 64); err != nil || chain == 0 || strconv.FormatUint(chain, 10) != c.ChainID {
		return c, fmt.Errorf("invalid chain ID")
	}
	if len(c.GenesisRoot) != 66 || !strings.HasPrefix(c.GenesisRoot, "0x") {
		return c, fmt.Errorf("invalid genesis root")
	}
	for _, character := range c.GenesisRoot[2:] {
		if !(character >= '0' && character <= '9' || character >= 'a' && character <= 'f' || character >= 'A' && character <= 'F') {
			return c, fmt.Errorf("invalid genesis root")
		}
	}
	if _, port, err := net.SplitHostPort(c.ListenAddr); err != nil {
		return c, fmt.Errorf("invalid listen address")
	} else if number, err := strconv.ParseUint(port, 10, 16); err != nil || number == 0 {
		return c, fmt.Errorf("invalid listen port")
	}
	for _, endpoint := range []string{c.BeaconURL, c.ExecutionURL} {
		u, err := url.Parse(endpoint)
		if err != nil || u.Hostname() == "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
			return c, fmt.Errorf("invalid HTTP endpoint configuration")
		}
	}
	d, err := time.ParseDuration(env("ROOTED_REQUEST_TIMEOUT", "15s"))
	if err != nil || d <= 0 {
		return c, fmt.Errorf("invalid request timeout")
	}
	c.RequestTimeout = d
	return c, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
