package analysis

import (
	"strings"
	"testing"
)

func TestEvidenceDigestPreservesLargeIntegersAndRejectsTrailingJSON(t *testing.T) {
	a, err := digest([]byte(`{"value":18446744073709551615}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := digest([]byte(`{ "value": 18446744073709551615 }`))
	if err != nil || a != b {
		t.Fatalf("canonical digest changed: %s %s %v", a, b, err)
	}
	if _, err = digest([]byte(`{} {}`)); err == nil {
		t.Fatal("accepted trailing JSON evidence")
	}
	if strings.TrimSpace(a) == "" {
		t.Fatal("empty evidence digest")
	}
}
