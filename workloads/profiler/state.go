package main

import (
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/holiman/uint256"
	"time"
)

// Delegate to the unwrapped StateDB. Inner native calls are not re-intercepted,
// so these measured delegate intervals cannot double-count one another.
type trackedState struct {
	inEVM    bool
	evmState int64
	vm.StateDB
	counts  map[string]Counter
	elapsed int64
}

func (s *trackedState) record(method string, start time.Time) {
	elapsed := time.Since(start).Nanoseconds()
	c := s.counts[method]
	c.Calls++
	c.NS += elapsed
	s.counts[method] = c
	s.elapsed += elapsed
	if s.inEVM {
		s.evmState += elapsed
	}
}
func (s *trackedState) GetState(a common.Address, k common.Hash) common.Hash {
	start := time.Now()
	v := s.StateDB.GetState(a, k)
	s.record("GetState", start)
	return v
}
func (s *trackedState) GetStateAndCommittedState(a common.Address, k common.Hash) (common.Hash, common.Hash) {
	start := time.Now()
	a1, a2 := s.StateDB.GetStateAndCommittedState(a, k)
	s.record("GetStateAndCommittedState", start)
	return a1, a2
}
func (s *trackedState) SetState(a common.Address, k, v common.Hash) common.Hash {
	start := time.Now()
	old := s.StateDB.SetState(a, k, v)
	s.record("SetState", start)
	return old
}
func (s *trackedState) GetBalance(a common.Address) *uint256.Int {
	start := time.Now()
	v := s.StateDB.GetBalance(a)
	s.record("GetBalance", start)
	return v
}
func (s *trackedState) GetNonce(a common.Address) uint64 {
	start := time.Now()
	v := s.StateDB.GetNonce(a)
	s.record("GetNonce", start)
	return v
}
func (s *trackedState) SetNonce(a common.Address, n uint64, r tracing.NonceChangeReason) {
	start := time.Now()
	s.StateDB.SetNonce(a, n, r)
	s.record("SetNonce", start)
}
func (s *trackedState) GetCode(a common.Address) []byte {
	start := time.Now()
	v := s.StateDB.GetCode(a)
	s.record("GetCode", start)
	return v
}
func (s *trackedState) GetCodeSize(a common.Address) int {
	start := time.Now()
	v := s.StateDB.GetCodeSize(a)
	s.record("GetCodeSize", start)
	return v
}
func (s *trackedState) GetCodeHash(a common.Address) common.Hash {
	start := time.Now()
	v := s.StateDB.GetCodeHash(a)
	s.record("GetCodeHash", start)
	return v
}
func (s *trackedState) SetCode(a common.Address, code []byte, r tracing.CodeChangeReason) []byte {
	start := time.Now()
	v := s.StateDB.SetCode(a, code, r)
	s.record("SetCode", start)
	return v
}
func (s *trackedState) AddBalance(a common.Address, n *uint256.Int, r tracing.BalanceChangeReason) uint256.Int {
	start := time.Now()
	v := s.StateDB.AddBalance(a, n, r)
	s.record("AddBalance", start)
	return v
}
func (s *trackedState) SubBalance(a common.Address, n *uint256.Int, r tracing.BalanceChangeReason) uint256.Int {
	start := time.Now()
	v := s.StateDB.SubBalance(a, n, r)
	s.record("SubBalance", start)
	return v
}
func (s *trackedState) Exist(a common.Address) bool {
	start := time.Now()
	v := s.StateDB.Exist(a)
	s.record("Exist", start)
	return v
}
