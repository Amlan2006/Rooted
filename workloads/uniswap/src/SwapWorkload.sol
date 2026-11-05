// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 { function transfer(address recipient, uint256 amount) external returns (bool); }
interface IWETH is IERC20 { function deposit() external payable; }
interface IPool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified,
                  uint160 sqrtPriceLimitX96, bytes calldata data) external returns (int256, int256);
}

/// Local fork workload only. No user wallet or public-network deployment required.
contract SwapWorkload {
    address constant FACTORY = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    uint160 constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    address private activePool;
    error ExpectedWorkloadRevert();

    function fund() external payable { IWETH(WETH).deposit{value: msg.value}(); }
    function runSwap(address pool, uint256 amount, bool revertAfter) external {
        require(IPool(pool).factory() == FACTORY, "factory");
        require(IPool(pool).token1() == WETH, "token1");
        require(amount <= uint256(type(int256).max), "amount");
        activePool = pool;
        IPool(pool).swap(address(this), false, int256(amount), MAX_SQRT_RATIO - 1, "");
        activePool = address(0);
        if (revertAfter) revert ExpectedWorkloadRevert();
    }
    function uniswapV3SwapCallback(int256 amount0, int256 amount1, bytes calldata) external {
        require(msg.sender == activePool && activePool != address(0), "pool");
        if (amount0 > 0) require(IERC20(IPool(msg.sender).token0()).transfer(msg.sender, uint256(amount0)), "pay0");
        if (amount1 > 0) require(IWETH(WETH).transfer(msg.sender, uint256(amount1)), "pay1");
    }
}
