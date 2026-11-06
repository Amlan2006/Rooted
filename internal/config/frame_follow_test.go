package config

import "testing"

func TestFrameGenesisFollowIsExplicit(t *testing.T) {
	frameDefaults(t)
	t.Setenv("ROOTED_FRAME_GENESIS_HASH", "follow")
	if f, err := LoadFrame(); err != nil || f.Genesis != "follow" {
		t.Fatalf("follow rejected: %+v %v", f, err)
	}
	for _, value := range []string{"Follow", "follow ", "latest"} {
		t.Setenv("ROOTED_FRAME_GENESIS_HASH", value)
		if _, err := LoadFrame(); err == nil {
			t.Fatalf("%q accepted as a genesis", value)
		}
	}
}
