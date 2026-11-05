package bal

import (
	"encoding/json"
	"errors"
	"strings"
)

// AddPrestate records access candidates, never claiming every key is a read.
func AddPrestate(a *Access, raw json.RawMessage) error {
	var accounts map[string]struct {
		Storage map[string]string `json:"storage"`
	}
	if err := json.Unmarshal(raw, &accounts); err != nil {
		return err
	}
	if accounts == nil {
		return errors.New("prestate account map missing")
	}
	for address, value := range accounts {
		addr, err := Address(address)
		if err != nil {
			return err
		}
		for key := range value.Storage {
			k, err := Word(key)
			if err != nil {
				return err
			}
			a.Candidates = appendLocation(a.Candidates, Location{Address: addr, Field: "storage", Key: k})
		}
	}
	a.Coverage = appendUnique(a.Coverage, "prestate_keys_are_access_candidates_not_a_complete_read_set")
	return nil
}

// AddParityDiff imports explicit committed changes. Reverted/no-op writes are
// absent here; SSTORE's implicit read is obtained separately from opcode evidence.
func AddParityDiff(a *Access, raw json.RawMessage) error {
	var response struct {
		Diff map[string]struct {
			Balance json.RawMessage            `json:"balance"`
			Nonce   json.RawMessage            `json:"nonce"`
			Code    json.RawMessage            `json:"code"`
			Storage map[string]json.RawMessage `json:"storage"`
		} `json:"stateDiff"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return err
	}
	if response.Diff == nil {
		return errors.New("stateDiff missing")
	}
	for address, account := range response.Diff {
		addr, err := Address(address)
		if err != nil {
			return err
		}
		for field, v := range map[string]json.RawMessage{"balance": account.Balance, "nonce": account.Nonce, "code": account.Code} {
			if changed(v) {
				a.Writes = appendLocation(a.Writes, Location{Address: addr, Field: field})
			}
		}
		for key, v := range account.Storage {
			if changed(v) {
				k, err := Word(key)
				if err != nil {
					return err
				}
				a.Writes = appendLocation(a.Writes, Location{Address: addr, Field: "storage", Key: k})
			}
		}
	}
	return nil
}
func changed(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == `"="` {
		return false
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return false
	}
	for _, key := range []string{"*", "+", "-"} {
		if _, ok := obj[key]; ok {
			return true
		}
	}
	return false
}

// AddGethDiff handles prestateTracer diffMode. Missing scalar fields in an
// existing post-account mean unchanged; deleted storage keys mean zeroed slots.
func AddGethDiff(a *Access, raw json.RawMessage) error {
	type account struct {
		Balance *string           `json:"balance"`
		Nonce   *json.Number      `json:"nonce"`
		Code    *string           `json:"code"`
		Storage map[string]string `json:"storage"`
	}
	var d struct {
		Pre  map[string]account `json:"pre"`
		Post map[string]account `json:"post"`
	}
	if err := json.Unmarshal(raw, &d); err != nil {
		return err
	}
	if d.Pre == nil || d.Post == nil {
		return errors.New("prestate diff maps missing")
	}
	addresses := map[string]bool{}
	for x := range d.Pre {
		addresses[x] = true
	}
	for x := range d.Post {
		addresses[x] = true
	}
	for x := range addresses {
		addr, err := Address(x)
		if err != nil {
			return err
		}
		before, had := d.Pre[x]
		after, has := d.Post[x]
		for _, f := range []struct {
			field   string
			changed bool
		}{{"balance", (!has && had) || after.Balance != nil && (before.Balance == nil || *after.Balance != *before.Balance)}, {"nonce", (!has && had) || after.Nonce != nil && (before.Nonce == nil || *after.Nonce != *before.Nonce)}, {"code", (!has && had) || after.Code != nil && (before.Code == nil || *after.Code != *before.Code)}} {
			if f.changed {
				a.Writes = appendLocation(a.Writes, Location{Address: addr, Field: f.field})
			}
		}
		keys := map[string]bool{}
		for key := range before.Storage {
			keys[key] = true
		}
		for key := range after.Storage {
			keys[key] = true
		}
		for key := range keys {
			old := before.Storage[key]
			value := after.Storage[key]
			if old == "" {
				old = "0x0"
			}
			if value == "" {
				value = "0x0"
			}
			o, e := Word(old)
			if e != nil {
				return e
			}
			v, e := Word(value)
			if e != nil {
				return e
			}
			if o != v {
				k, e := Word(key)
				if e != nil {
					return e
				}
				a.Writes = appendLocation(a.Writes, Location{Address: addr, Field: "storage", Key: k})
			}
		}
	}
	return nil
}

// AddOpcodes attributes SLOAD/SSTORE reads to storage context, preserving the
// caller's storage for DELEGATECALL/CALLCODE. Creation and unresolved contexts
// make storage coverage incomplete instead of assigning reads to guessed owners.
func AddOpcodes(a *Access, raw json.RawMessage, root string, limit int) error {
	var trace OpcodeTrace
	if err := json.Unmarshal(raw, &trace); err != nil {
		return err
	}
	if trace.Logs == nil {
		return errors.New("opcode trace missing structLogs")
	}
	context := map[int]string{}
	complete := len(trace.Logs) > 0
	if !complete {
		a.Coverage = appendUnique(a.Coverage, "empty_opcode_trace_storage_coverage_unknown")
	}
	if len(trace.Logs) > 0 {
		addr, err := Address(root)
		if err != nil {
			complete = false
		} else {
			context[trace.Logs[0].Depth] = addr
		}
	}
	for i, step := range trace.Logs {
		if len(step.Error) > 0 && string(step.Error) != "null" && string(step.Error) != `""` {
			complete = false
			a.Coverage = appendUnique(a.Coverage, "opcode_error_limits_access_coverage")
			continue
		}
		if i > 0 && step.Depth > trace.Logs[i-1].Depth {
			previous := trace.Logs[i-1]
			owner := context[previous.Depth]
			if step.Depth != previous.Depth+1 {
				complete = false
			}
			switch previous.Op {
			case "CALL", "STATICCALL":
				if len(previous.Stack) >= 2 {
					word, err := Word("0x" + strings.TrimPrefix(previous.Stack[len(previous.Stack)-2], "0x"))
					if err != nil {
						delete(context, step.Depth)
						complete = false
					} else {
						context[step.Depth] = "0x" + word[len(word)-40:]
					}
				} else {
					delete(context, step.Depth)
					complete = false
				}
			case "DELEGATECALL", "CALLCODE":
				context[step.Depth] = owner
			default:
				delete(context, step.Depth)
				complete = false
				a.Coverage = appendUnique(a.Coverage, "creation_or_unknown_call_storage_context")
			}
		}
		owner := context[step.Depth]
		if step.Op == "CREATE" || step.Op == "CREATE2" || step.Op == "SELFDESTRUCT" || step.Op == "AUTH" || step.Op == "AUTHCALL" {
			complete = false
			a.Coverage = appendUnique(a.Coverage, "unsupported_account_lifecycle_semantics")
		}
		if step.Op == "SLOAD" || step.Op == "SSTORE" {
			if owner == "" || len(step.Stack) < 1 {
				complete = false
				continue
			}
			key, err := Word("0x" + strings.TrimPrefix(step.Stack[len(step.Stack)-1], "0x"))
			if err != nil {
				return err
			}
			a.Reads = appendLocation(a.Reads, Location{Address: owner, Field: "storage", Key: key})
		}
		// Non-storage reads are conservative: full account existence/delegation and
		// gas semantics are still not claimed complete by the graph.
		if step.Op == "SELFBALANCE" && owner != "" {
			a.Reads = appendLocation(a.Reads, Location{Address: owner, Field: "balance"})
		}
		if step.Op == "BALANCE" || step.Op == "EXTCODESIZE" || step.Op == "EXTCODEHASH" || step.Op == "EXTCODECOPY" {
			if len(step.Stack) == 0 {
				complete = false
				continue
			}
			word := strings.TrimPrefix(step.Stack[len(step.Stack)-1], "0x")
			if len(word) < 40 {
				word = strings.Repeat("0", 40-len(word)) + word
			}
			addr := "0x" + strings.ToLower(word[len(word)-40:])
			field := "code"
			if step.Op == "BALANCE" {
				field = "balance"
			}
			a.Reads = appendLocation(a.Reads, Location{Address: addr, Field: field})
		}
	}
	if limit > 0 && len(trace.Logs) >= limit {
		complete = false
		a.Coverage = appendUnique(a.Coverage, "opcode_trace_step_limit_reached")
	}
	a.StorageReadsComplete = complete
	a.Coverage = appendUnique(a.Coverage, "storage_reads_include_sstore_implicit_reads_and_reverted_frames")
	return nil
}
func appendUnique(values []string, value string) []string {
	for _, v := range values {
		if v == value {
			return values
		}
	}
	return append(values, value)
}
func AddRead(a *Access, l Location) { a.Reads = appendLocation(a.Reads, l) }
