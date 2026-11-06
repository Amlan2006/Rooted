package profiler

import (
	"encoding/json"
	"os"
	"testing"
)

func profile(t *testing.T) Report {
	t.Helper()
	raw, err := os.ReadFile("../../demo/profiler/profile.json")
	if err != nil {
		t.Fatal(err)
	}
	var wrapper struct {
		Data Report `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		t.Fatal(err)
	}
	return wrapper.Data
}
func TestMeasuredNativeMetricsRequireBoundIdentityAndDisjointTotals(t *testing.T) {
	p := profile(t)
	if err := ValidateMetrics(p.Metrics, p.BlockHash, 85); err != nil {
		t.Fatal(err)
	}
	if ValidateMetrics(p.Metrics, "0xwrong", 85) == nil || ValidateMetrics(p.Metrics, p.BlockHash, 84) == nil {
		t.Fatal("unbound report accepted")
	}
	var raw map[string]any
	_ = json.Unmarshal(p.Metrics, &raw)
	s := raw["samples"].([]any)[0].(map[string]any)
	s["state_access_ns"] = s["apply_ns"].(float64) + 1
	b, _ := json.Marshal(raw)
	if ValidateMetrics(b, p.BlockHash, 85) == nil {
		t.Fatal("overlapping state interval accepted")
	}
}
