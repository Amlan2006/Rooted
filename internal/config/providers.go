package config

import (
	"fmt"
	"net/url"
)

// Reference providers are operator configuration, never supplied by the browser.
type ProviderConfig struct{ ExecutionURL, BeaconURL string }

func LoadProviders() (ProviderConfig, error) {
	p := ProviderConfig{
		ExecutionURL: env("ROOTED_REFERENCE_EXECUTION_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
		BeaconURL:    env("ROOTED_REFERENCE_BEACON_URL", "https://ethereum-sepolia-beacon-api.publicnode.com"),
	}
	for _, endpoint := range []string{p.ExecutionURL, p.BeaconURL} {
		u, err := url.Parse(endpoint)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Fragment != "" {
			return p, fmt.Errorf("invalid reference provider endpoint")
		}
	}
	return p, nil
}
