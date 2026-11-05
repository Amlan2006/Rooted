package bal

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// DecodeNativeRLP accepts the encoded EIP-7928 BAL from a Beacon payload envelope.
// The JSON and RLP transports share the same semantic and commitment validation.
func DecodeNativeRLP(encoded string, transactions int, commitment string) (Native, error) {
	if !strings.HasPrefix(encoded, "0x") || len(encoded) > 32<<20 {
		return Native{}, errors.New("invalid encoded BAL length or prefix")
	}
	raw, err := hex.DecodeString(encoded[2:])
	if err != nil {
		return Native{}, err
	}
	root, rest, err := takeRLP(raw)
	if err != nil || len(rest) != 0 || !root.list {
		return Native{}, errors.New("BAL must be one canonical RLP list")
	}
	entries, err := root.children()
	if err != nil {
		return Native{}, err
	}
	accounts := make([]Account, 0, len(entries))
	for _, entry := range entries {
		fields, err := entry.children()
		if err != nil || len(fields) != 6 {
			return Native{}, errors.New("BAL account must have six fields")
		}
		if fields[0].list || len(fields[0].data) != 20 {
			return Native{}, errors.New("invalid BAL address")
		}
		a := Account{Address: "0x" + hex.EncodeToString(fields[0].data)}
		slots, err := fields[1].children()
		if err != nil {
			return Native{}, err
		}
		for _, slot := range slots {
			parts, e := slot.children()
			if e != nil || len(parts) != 2 {
				return Native{}, errors.New("invalid BAL storage entry")
			}
			key, e := parts[0].quantity(32)
			if e != nil {
				return Native{}, e
			}
			changes, e := rlpChanges(parts[1], 32)
			if e != nil {
				return Native{}, e
			}
			a.Storage = append(a.Storage, Slot{Key: key, Changes: changes})
		}
		reads, err := fields[2].children()
		if err != nil {
			return Native{}, err
		}
		for _, read := range reads {
			key, e := read.quantity(32)
			if e != nil {
				return Native{}, e
			}
			a.Reads = append(a.Reads, key)
		}
		a.Balance, err = rlpChanges(fields[3], 32)
		if err != nil {
			return Native{}, err
		}
		a.Nonce, err = rlpChanges(fields[4], 8)
		if err != nil {
			return Native{}, err
		}
		codes, err := fields[5].children()
		if err != nil {
			return Native{}, err
		}
		for _, code := range codes {
			pair, e := code.children()
			if e != nil || len(pair) != 2 || pair[1].list {
				return Native{}, errors.New("invalid BAL code entry")
			}
			index, e := pair[0].quantity(4)
			if e != nil {
				return Native{}, e
			}
			a.Code = append(a.Code, CodeChange{Index: index, Code: "0x" + hex.EncodeToString(pair[1].data)})
		}
		accounts = append(accounts, a)
	}
	data, err := json.Marshal(accounts)
	if err != nil {
		return Native{}, err
	}
	result, err := DecodeNative(data, transactions, commitment)
	if err != nil {
		return result, err
	}
	if result.ComputedHash != Keccak(raw) {
		return Native{}, errors.New("noncanonical BAL encoding")
	}
	result.Schema = "eip-7928-rlp-index-value-v1"
	return result, nil
}

type rlpItem struct {
	data []byte
	list bool
}

func (item rlpItem) children() ([]rlpItem, error) {
	if !item.list {
		return nil, errors.New("expected BAL RLP list")
	}
	items := []rlpItem{}
	rest := item.data
	for len(rest) > 0 {
		child, next, err := takeRLP(rest)
		if err != nil {
			return nil, err
		}
		if len(items) >= 1_000_000 {
			return nil, errors.New("BAL RLP list exceeds entry bound")
		}
		items = append(items, child)
		rest = next
	}
	return items, nil
}
func (item rlpItem) quantity(size int) (string, error) {
	if item.list || len(item.data) > size || (len(item.data) > 0 && item.data[0] == 0) {
		return "", errors.New("invalid BAL RLP integer")
	}
	return "0x" + new(big.Int).SetBytes(item.data).Text(16), nil
}
func rlpChanges(item rlpItem, size int) ([]RPCChange, error) {
	items, err := item.children()
	if err != nil {
		return nil, err
	}
	changes := []RPCChange{}
	for _, entry := range items {
		pair, e := entry.children()
		if e != nil || len(pair) != 2 {
			return nil, errors.New("invalid BAL change")
		}
		index, e := pair[0].quantity(4)
		if e != nil {
			return nil, e
		}
		value, e := pair[1].quantity(size)
		if e != nil {
			return nil, e
		}
		changes = append(changes, RPCChange{Index: index, Value: value})
	}
	return changes, nil
}

// takeRLP validates lengths without recursion or allocation proportional to declared lengths.
func takeRLP(raw []byte) (rlpItem, []byte, error) {
	bad := func() (rlpItem, []byte, error) { return rlpItem{}, nil, fmt.Errorf("invalid or noncanonical BAL RLP") }
	if len(raw) == 0 {
		return bad()
	}
	prefix := raw[0]
	if prefix < 0x80 {
		return rlpItem{data: raw[:1]}, raw[1:], nil
	}
	list := prefix >= 0xc0
	base := byte(0x80)
	if list {
		base = 0xc0
	}
	n := int(prefix - base)
	offset := 1
	if n > 55 {
		width := n - 55
		if width > 8 || len(raw) < 1+width || raw[1] == 0 {
			return bad()
		}
		var length uint64
		for _, b := range raw[1 : 1+width] {
			length = length<<8 | uint64(b)
		}
		offset += width
		if length < 56 || length > uint64(len(raw)-offset) {
			return bad()
		}
		n = int(length)
	}
	if n > len(raw)-offset {
		return bad()
	}
	if !list && n == 1 && raw[offset] < 0x80 {
		return bad()
	}
	return rlpItem{data: raw[offset : offset+n], list: list}, raw[offset+n:], nil
}
