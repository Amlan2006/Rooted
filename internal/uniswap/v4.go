package uniswap

import (
	"encoding/hex"
	"errors"
	"math/big"
	"rooted/internal/bal"
	"strings"
)

// Sepolia v4 singleton, https://docs.uniswap.org/contracts/v4/deployments (24,009 code bytes on our node).
const PoolManager = "0xe03a1074c86cfedd5c142c4f04f1a1536e203543"
const SwapV4Topic = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"          // Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)
const ModifyLiquidityTopic = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec" // ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)
const InitializeTopic = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"      // Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)

// poolsSlot is PoolManager's `mapping(PoolId => Pool.State) _pools` (v4-core StateLibrary.POOLS_SLOT).
const poolsSlot = 6

// SwapV4 amounts are raw and signed from the swapper's side (negative = paid in), unlike v3.
type SwapV4 struct {
	PoolID      string `json:"pool_id"`
	Transaction string `json:"transaction_hash"`
	LogIndex    string `json:"log_index"`
	Sender      string `json:"sender"`
	Amount0     string `json:"amount0_raw"`
	Amount1     string `json:"amount1_raw"`
	SqrtPrice   string `json:"sqrt_price_x96"`
	Liquidity   string `json:"liquidity"`
	Tick        int64  `json:"tick"`
	Fee         uint64 `json:"fee"`
}

var two256 = new(big.Int).Lsh(big.NewInt(1), 256)

func bytes32(s string) ([]byte, error) {
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil || len(b) != 32 || !strings.HasPrefix(s, "0x") {
		return nil, errors.New("invalid bytes32")
	}
	return b, nil
}

// word32 is v as a 32-byte two's-complement ABI word.
func word32(v *big.Int) []byte { return new(big.Int).Mod(v, two256).FillBytes(make([]byte, 32)) }

// fits reports whether v is a valid intN (signed) or uintN value.
func fits(v *big.Int, bits uint, isSigned bool) bool {
	if !isSigned {
		return v.Sign() >= 0 && v.BitLen() <= int(bits)
	}
	limit := new(big.Int).Lsh(big.NewInt(1), bits-1)
	return v.Cmp(new(big.Int).Neg(limit)) >= 0 && v.Cmp(limit) < 0
}

// managerEvent validates a retained PoolManager event and returns its ABI data.
func managerEvent(log Log, topic string, topics, size int) ([]byte, error) {
	if log.Removed || len(log.Topics) != topics || !strings.EqualFold(log.Topics[0], topic) || !strings.EqualFold(log.Address, PoolManager) {
		return nil, errors.New("not a retained PoolManager event")
	}
	if _, err := bytes32(log.Topics[1]); err != nil {
		return nil, err
	}
	data, err := hex.DecodeString(strings.TrimPrefix(log.Data, "0x"))
	if err != nil || len(data) != size {
		return nil, errors.New("invalid PoolManager event data length")
	}
	return data, nil
}

func DecodeSwapV4(log Log) (SwapV4, error) {
	data, err := managerEvent(log, SwapV4Topic, 3, 192)
	if err != nil {
		return SwapV4{}, err
	}
	sender, err := topicAddress(log.Topics[2])
	if err != nil {
		return SwapV4{}, err
	}
	amount0, amount1 := signed(data[:32]), signed(data[32:64])
	price := new(big.Int).SetBytes(data[64:96])
	liquidity := new(big.Int).SetBytes(data[96:128])
	tick := signed(data[128:160])
	fee := new(big.Int).SetBytes(data[160:192])
	if !fits(amount0, 128, true) || !fits(amount1, 128, true) || !fits(price, 160, false) || !fits(liquidity, 128, false) || !fits(tick, 24, true) || !fits(fee, 24, false) {
		return SwapV4{}, errors.New("SwapV4 ABI integer out of range")
	}
	return SwapV4{PoolID: strings.ToLower(log.Topics[1]), Transaction: strings.ToLower(log.Hash), LogIndex: log.Index, Sender: sender, Amount0: amount0.String(), Amount1: amount1.String(), SqrtPrice: price.String(), Liquidity: liquidity.String(), Tick: tick.Int64(), Fee: fee.Uint64()}, nil
}

type modifyLiquidity struct {
	pool, positionKey string
	lower, upper      int64
}

// decodeModifyLiquidity derives the v4 position key keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt)).
func decodeModifyLiquidity(log Log) (modifyLiquidity, error) {
	data, err := managerEvent(log, ModifyLiquidityTopic, 3, 128)
	if err != nil {
		return modifyLiquidity{}, err
	}
	owner, err := topicAddress(log.Topics[2])
	if err != nil {
		return modifyLiquidity{}, err
	}
	lower, upper := signed(data[:32]), signed(data[32:64])
	if !fits(lower, 24, true) || !fits(upper, 24, true) {
		return modifyLiquidity{}, errors.New("ModifyLiquidity tick out of range")
	}
	ownerBytes, _ := hex.DecodeString(owner[2:])
	packed := append(append(append(ownerBytes, data[29:32]...), data[61:64]...), data[96:128]...)
	return modifyLiquidity{pool: strings.ToLower(log.Topics[1]), positionKey: bal.Keccak(packed), lower: lower.Int64(), upper: upper.Int64()}, nil
}

// PoolStateSlot is the base slot of Pool.State for poolID: keccak256(poolId ‖ uint256(6)).
func PoolStateSlot(poolID string) (string, error) {
	id, err := bytes32(poolID)
	if err != nil {
		return "", err
	}
	return bal.Keccak(append(id, word32(big.NewInt(poolsSlot))...)), nil
}
