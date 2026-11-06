package main

import (
	"strings"
	"testing"
)

func TestXrayArguments(t *testing.T) {
	hash := "0x" + strings.Repeat("d", 64)
	for _, tc := range []struct {
		args    []string
		command string
	}{
		{[]string{"xray", hash}, "xray"},
		{[]string{"xray", "--capture", "capture.json.gz"}, "xray-capture"},
		{[]string{"xray", "--capture", "capture.json", "envelope.json"}, "xray-capture"},
		{[]string{"xray-follow"}, "xray-follow"},
		{[]string{"xray"}, ""},
		{[]string{"xray", "latest"}, ""},
		{[]string{"xray", hash, "extra"}, ""},
		{[]string{"xray", "--capture"}, ""},
		{[]string{"xray", "--capture", ""}, ""},
		{[]string{"xray", "--capture", "capture.json", ""}, ""},
		{[]string{"xray", "--capture", "a", "b", "c"}, ""},
		{[]string{"xray", "--other", "capture.json"}, ""},
		{[]string{"xray-follow", "extra"}, ""},
		{[]string{"xray-capture", "capture.json"}, ""},
	} {
		command, _, err := parseArguments(tc.args)
		if (err != nil) != (tc.command == "") || command != tc.command {
			t.Errorf("%v: got (%q,%v)", tc.args, command, err)
		}
	}
}
