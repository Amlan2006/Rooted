package framemempool

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestFollowGenesisReturnsLiveHash(t *testing.T) {
	client := testRPC(testInfo())
	_, genesis, _, err := verifyIdentity(context.Background(), client, client, 1337, FollowGenesis)
	if err != nil || genesis != testHash {
		t.Fatalf("follow mode did not adopt live genesis: %q %v", genesis, err)
	}
	if _, _, _, err = verifyIdentity(context.Background(), client, client, 1, FollowGenesis); err == nil {
		t.Fatal("follow mode accepted a wrong chain")
	}
	if _, _, _, err = verifyIdentity(context.Background(), client, client, 1337, "0x"+strings.Repeat("b", 64)); err == nil {
		t.Fatal("pinned genesis mismatch accepted")
	}
}

func TestDevnetResetStartsNewEpoch(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	info := testInfo()
	if _, err := s.Register(ctx, testScope, info, testHash, nil, stamp); err != nil {
		t.Fatal(err)
	}
	cursor := "page-2"
	if err := s.Status(ctx, testScope, info.Boot, "poll", "ok", &cursor); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Event(ctx, testScope, info.Boot, Event{Seq: 1, Hash: testHash, Kind: "admitted", At: stamp.UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	reset := info
	reset.Boot, reset.Oldest, reset.Latest = "boot-two", 1, 2
	genesis := "0x" + strings.Repeat("c", 64)
	node, err := s.Register(ctx, testScope, reset, genesis, nil, stamp.Add(time.Minute))
	if err != nil || node.Genesis != genesis || node.Seq != 0 || node.Cursor != nil || node.Info.Boot != "boot-two" {
		t.Fatalf("reset did not start a new epoch: %+v %v", node, err)
	}
	incidents, err := s.Incidents(ctx, testScope, 50)
	if err != nil {
		t.Fatal(err)
	}
	var found *Incident
	for i := range incidents {
		if incidents[i].Code == "node_restarted" {
			t.Fatal("reset also journaled node_restarted")
		}
		if incidents[i].Code == "devnet_reset" {
			found = &incidents[i]
		}
	}
	if found == nil || found.Boot != "boot-two" {
		t.Fatalf("devnet_reset not journaled: %+v", incidents)
	}
	var detail map[string]string
	if err = json.Unmarshal(found.Detail, &detail); err != nil || detail["previous_genesis"] != testHash || detail["current_genesis"] != genesis || detail["previous_boot"] != "boot-one" || detail["current_boot"] != "boot-two" {
		t.Fatalf("bad reset detail %s %v", found.Detail, err)
	}
	// The pre-reset archive survives, and the new epoch accepts its own sequence 1.
	if _, err = s.Event(ctx, testScope, reset.Boot, Event{Seq: 1, Hash: testHash, Kind: "rejected", At: stamp.UnixMilli()}); err != nil {
		t.Fatal(err)
	}
	if states, err := s.States(ctx, testScope, testHash, 50); err != nil || len(states) != 2 {
		t.Fatalf("pre-reset evidence lost: %d %v", len(states), err)
	}
	wrong := reset
	wrong.ChainID = 1
	if _, err = s.Register(ctx, testScope, wrong, genesis, nil, stamp.Add(2*time.Minute)); err == nil {
		t.Fatal("chain change accepted as a reset")
	}
}
