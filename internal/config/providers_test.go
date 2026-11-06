package config

import "testing"

func TestReferenceProviderConfiguration(t *testing.T) {
	t.Setenv("ROOTED_REFERENCE_EXECUTION_URL", "")
	t.Setenv("ROOTED_REFERENCE_BEACON_URL", "")
	p, err := LoadProviders()
	if err != nil || p.ExecutionURL != "https://ethereum-sepolia-rpc.publicnode.com" || p.BeaconURL == "" {
		t.Fatalf("invalid defaults: %+v %v", p, err)
	}
	for _, key := range []string{"ROOTED_REFERENCE_EXECUTION_URL", "ROOTED_REFERENCE_BEACON_URL"} {
		for _, value := range []string{"file:///tmp/private", "https://host.invalid/rpc#fragment", "http://"} {
			t.Run(key+value, func(t *testing.T) {
				t.Setenv(key, value)
				if _, err := LoadProviders(); err == nil {
					t.Fatal("invalid provider endpoint accepted")
				}
			})
		}
	}
}
