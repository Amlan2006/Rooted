package uniswap

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"testing"
)

func word(n int64) string {
	v := big.NewInt(n)
	if n < 0 {
		v.Add(v, new(big.Int).Lsh(big.NewInt(1), 256))
	}
	return fmt.Sprintf("%064x", v)
}
func TestSwapSignedABIAndMalformedData(t *testing.T) {
	address := "0x00000000000000000000000000000000000000aa"
	log := Log{Address: address, Topics: []string{SwapTopic, wordTopic(address), wordTopic(address)}, Data: "0x" + word(-500) + word(300) + word(100) + word(20) + word(-1)}
	swap, err := DecodeSwap(log)
	if err != nil || swap.Amount0 != "-500" || swap.Amount1 != "300" || swap.Tick != -1 || swap.PoolVerified {
		t.Fatal(swap, err)
	}
	log.Removed = true
	if _, err = DecodeSwap(log); err == nil {
		t.Fatal("removed event accepted")
	}
	log.Removed = false
	log.Data = "0x" + word(1)
	if _, err = DecodeSwap(log); err == nil {
		t.Fatal("short ABI accepted")
	}
}
func wordTopic(address string) string { return "0x" + strings.Repeat("0", 24) + address[2:] }
func TestSuccessfulInnerSwapRevertedByAncestor(t *testing.T) {
	address := "0x00000000000000000000000000000000000000aa"
	input := SwapSelector + wordTopic(address)[2:] + word(0) + word(100) + word(200) + word(160) + word(0)
	if _, err := hex.DecodeString(input[2:]); err != nil {
		t.Fatal(err)
	}
	call := Call{To: address, Input: input}
	out := Attempts(Call{Error: "execution reverted", Calls: []Call{call}}, "tx", true)
	if len(out) != 1 || out[0].CallFailed || !out[0].AncestorFailed || out[0].Committed || !out[0].TransactionReverted {
		t.Fatal(out)
	}
	out = Attempts(call, "tx", false)
	if len(out) != 1 || !out[0].Committed || out[0].AmountSpecified != "100" {
		t.Fatal(out)
	}
}
