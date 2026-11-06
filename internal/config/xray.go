package config

import (
	"fmt"
	"strconv"
)

// XrayFollow reads ROOTED_XRAY_FOLLOW (default false); serve then X-rays head-2 every 12 s.
func XrayFollow() (bool, error) {
	v, err := strconv.ParseBool(env("ROOTED_XRAY_FOLLOW", "false"))
	if err != nil {
		return false, fmt.Errorf("invalid ROOTED_XRAY_FOLLOW")
	}
	return v, nil
}
