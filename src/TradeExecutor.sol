// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/IUniswapV3Router.sol";

contract TradeExecutor {
    address public immutable router;
    address public owner;

    constructor(address _router) {
        router = _router;
        owner = msg.sender;
    }

    function executeTrade(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint24 poolFee,
        uint256 deadline
    ) external returns (uint256) {
        require(deadline > block.timestamp, "Trade expired");
        require(amountIn > 0, "Zero amount");
        require(IERC20(tokenIn).balanceOf(msg.sender) >= amountIn, "Insufficient balance");

        // Transfer tokens to contract
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Transfer failed");

        // Approve Uniswap router
        require(IERC20(tokenIn).approve(router, amountIn), "Approval failed");

        // Execute trade
        return IUniswapV3Router(router).exactInputSingle(
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: msg.sender,
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function withdrawToken(address token, uint256 amount) external {
        require(msg.sender == owner, "Unauthorized");
        require(IERC20(token).transfer(owner, amount), "Withdrawal failed");
    }
}
