// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IERC20Minimal.sol";
import "../interfaces/IUniswapV3RouterMinimal.sol";

contract MockUniswapV3Router is IUniswapV3RouterMinimal {
    mapping(address => mapping(address => uint256)) public rates;

    event SwapExecuted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    function setRate(address tokenIn, address tokenOut, uint256 rate) external {
        rates[tokenIn][tokenOut] = rate;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external override returns (uint256 amountOut) {
        uint256 rate = rates[params.tokenIn][params.tokenOut];
        require(rate > 0, "Rate not set");

        amountOut = (params.amountIn * rate) / 1e18;
        require(amountOut >= params.amountOutMinimum, "Slippage too high");

        // Transfer tokens to recipient
        require(IERC20Minimal(params.tokenOut).transfer(params.recipient, amountOut), "Mock transfer failed");

        emit SwapExecuted(params.tokenIn, params.tokenOut, params.amountIn, amountOut);
        return amountOut;
    }
}
