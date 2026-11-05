package bal

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/crypto/sha3"
	"math/big"
	"strings"
)

func Address(s string) (string, error) {
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil || len(b) != 20 || !strings.HasPrefix(s, "0x") {
		return "", errors.New("invalid address")
	}
	return "0x" + hex.EncodeToString(b), nil
}
func Word(s string) (string, error) {
	b, err := Integer(s, 256)
	if err != nil {
		return "", err
	}
	return "0x" + fmt.Sprintf("%064x", new(big.Int).SetBytes(b)), nil
}
func Integer(s string, bits int) ([]byte, error) {
	if !strings.HasPrefix(s, "0x") || len(s) < 3 {
		return nil, errors.New("expected hex quantity")
	}
	v, ok := new(big.Int).SetString(s[2:], 16)
	if !ok || v.Sign() < 0 || v.BitLen() > bits {
		return nil, errors.New("hex quantity out of range")
	}
	return v.Bytes(), nil
}
func Number(s string) (uint64, error) {
	b, err := Integer(s, 64)
	if err != nil {
		return 0, err
	}
	return new(big.Int).SetBytes(b).Uint64(), nil
}
func codeBytes(s string) ([]byte, error) {
	if !strings.HasPrefix(s, "0x") {
		return nil, errors.New("invalid code hex")
	}
	return hex.DecodeString(s[2:])
}
func strRLP(b []byte) []byte {
	if len(b) == 1 && b[0] < 128 {
		return append([]byte{}, b...)
	}
	return prefixRLP(b, 0x80)
}
func listRLP(items ...[]byte) []byte { return prefixRLP(bytes.Join(items, nil), 0xc0) }
func prefixRLP(b []byte, base byte) []byte {
	if len(b) < 56 {
		return append([]byte{base + byte(len(b))}, b...)
	}
	n := new(big.Int).SetUint64(uint64(len(b))).Bytes()
	out := append([]byte{base + 55 + byte(len(n))}, n...)
	return append(out, b...)
}
func Keccak(data []byte) string {
	h := sha3.NewLegacyKeccak256()
	_, _ = h.Write(data)
	return "0x" + hex.EncodeToString(h.Sum(nil))
}

// DecodeNative validates canonical ordering/index ranges and reproduces EIP-7928
// RLP. Read-only keys remain block-scoped; no transaction read set is invented.
func DecodeNative(raw json.RawMessage, transactions int, commitment string) (Native, error) {
	var accounts []Account
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&accounts); err != nil || accounts == nil {
		return Native{}, errors.New("native BAL must be a JSON account array")
	}
	result := Native{Accounts: len(accounts), ReadOnly: []Location{}, Changes: []Change{}, Schema: "eip-7928-json-index-value-v1"}
	encoded := [][]byte{}
	previous := ""
	for _, a := range accounts {
		address, err := Address(a.Address)
		if err != nil {
			return result, err
		}
		if address <= previous {
			return result, errors.New("duplicate or unsorted BAL address")
		}
		previous = address
		addr, _ := hex.DecodeString(address[2:])
		fields := [][]byte{strRLP(addr)}
		slots := [][]byte{}
		slotKeys := map[string]bool{}
		lastKey := ""
		for _, slot := range a.Storage {
			key, err := Word(slot.Key)
			if err != nil {
				return result, err
			}
			if key <= lastKey || len(slot.Changes) == 0 {
				return result, errors.New("invalid BAL storage order or empty changes")
			}
			lastKey = key
			slotKeys[key] = true
			changes, err := decodeChanges(slot.Changes, Location{Address: address, Field: "storage", Key: key}, transactions, &result, 256)
			if err != nil {
				return result, err
			}
			keyBytes, _ := Integer(slot.Key, 256)
			slots = append(slots, listRLP(strRLP(keyBytes), listRLP(changes...)))
		}
		fields = append(fields, listRLP(slots...))
		reads := [][]byte{}
		lastKey = ""
		for _, read := range a.Reads {
			key, err := Word(read)
			if err != nil {
				return result, err
			}
			if key <= lastKey || slotKeys[key] {
				return result, errors.New("BAL read keys overlap writes or are not unique/sorted")
			}
			lastKey = key
			b, _ := Integer(read, 256)
			reads = append(reads, strRLP(b))
			result.ReadOnly = append(result.ReadOnly, Location{Address: address, Field: "storage", Key: key})
		}
		fields = append(fields, listRLP(reads...))
		for _, f := range []struct {
			name    string
			changes []RPCChange
			bits    int
		}{{"balance", a.Balance, 256}, {"nonce", a.Nonce, 64}} {
			changes, err := decodeChanges(f.changes, Location{Address: address, Field: f.name}, transactions, &result, f.bits)
			if err != nil {
				return result, err
			}
			fields = append(fields, listRLP(changes...))
		}
		codes := [][]byte{}
		var last uint64
		for i, c := range a.Code {
			index, err := Number(c.Index)
			if err != nil || index > uint64(transactions+1) || (i > 0 && index <= last) {
				return result, errors.New("invalid BAL code index")
			}
			last = index
			b, err := codeBytes(c.Code)
			if err != nil {
				return result, err
			}
			ib, _ := Integer(c.Index, 32)
			codes = append(codes, listRLP(strRLP(ib), strRLP(b)))
			result.Changes = append(result.Changes, normalized(Location{Address: address, Field: "code"}, index, transactions, strings.ToLower(c.Code), "native_bal"))
		}
		fields = append(fields, listRLP(codes...))
		encoded = append(encoded, listRLP(fields...))
	}
	result.ComputedHash = Keccak(listRLP(encoded...))
	if commitment != "" {
		match := strings.EqualFold(result.ComputedHash, commitment)
		result.CommitmentVerified = &match
		if !match {
			return result, errors.New("native BAL commitment mismatch")
		}
	}
	return result, nil
}
func decodeChanges(changes []RPCChange, loc Location, n int, result *Native, bits int) ([][]byte, error) {
	encoded := [][]byte{}
	var previous uint64
	for i, c := range changes {
		index, err := Number(c.Index)
		if err != nil || index > uint64(n+1) || index > 1<<32-1 || (i > 0 && index <= previous) {
			return nil, errors.New("invalid BAL change index/order")
		}
		previous = index
		value, err := Integer(c.Value, bits)
		if err != nil {
			return nil, err
		}
		ib, _ := Integer(c.Index, 32)
		encoded = append(encoded, listRLP(strRLP(ib), strRLP(value)))
		v := "0x" + new(big.Int).SetBytes(value).Text(16)
		result.Changes = append(result.Changes, normalized(loc, index, n, v, "native_bal"))
	}
	return encoded, nil
}
func normalized(loc Location, index uint64, n int, value, source string) Change {
	phase := "transaction"
	var tx *uint64
	if index == 0 {
		phase = "pre_execution"
	} else if index == uint64(n+1) {
		phase = "post_execution"
	} else {
		v := index - 1
		tx = &v
	}
	return Change{Location: loc, Index: index, TransactionIndex: tx, Phase: phase, Value: value, Source: source}
}
func NativeAccess(native Native, hashes []string) []Access {
	out := make([]Access, len(hashes))
	for i, h := range hashes {
		out[i] = Access{Index: uint64(i), Hash: h, Reads: []Location{}, Writes: []Location{}, Candidates: []Location{}, Coverage: []string{"native_bal_has_no_per_transaction_read_history"}}
	}
	for _, c := range native.Changes {
		if c.TransactionIndex != nil {
			index := *c.TransactionIndex
			out[index].Writes = appendLocation(out[index].Writes, c.Location)
		}
	}
	return out
}
func appendLocation(list []Location, l Location) []Location {
	for _, old := range list {
		if old == l {
			return list
		}
	}
	return append(list, l)
}
