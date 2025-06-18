// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IERC20Minimal.sol";
import "./interfaces/IUniswapV3RouterMinimal.sol";

contract TradeExecutor {
    address public immutable router;
    address public owner;
    uint256 public constant MAX_DEADLINE = 1800; // 30 minutes

    event TradeExecuted(
        address indexed executor, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut
    );

    event TokensDeposited(address indexed depositor, address token, uint256 amount);
    event TokensWithdrawn(address indexed owner, address token, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address _router) {
        router = _router;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized");
        _;
    }

    function executeTrade(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint24 poolFee,
        uint256 deadline
    ) external onlyOwner returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        require(deadline > block.timestamp, "Trade expired");
        require(deadline <= block.timestamp + MAX_DEADLINE, "Deadline too long");

        // Check contract balance
        uint256 balance = IERC20Minimal(tokenIn).balanceOf(address(this));
        require(balance >= amountIn, "Insufficient contract balance");

        // Approve router
        require(IERC20Minimal(tokenIn).approve(router, amountIn), "Approval failed");

        // Create params struct
        IUniswapV3RouterMinimal.ExactInputSingleParams memory params = IUniswapV3RouterMinimal.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: poolFee,
            recipient: address(this),
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: minAmountOut,
            sqrtPriceLimitX96: 0
        });

        // Execute trade
        amountOut = IUniswapV3RouterMinimal(router).exactInputSingle(params);
        emit TradeExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    function depositTokens(address token, uint256 amount) external {
        require(amount > 0, "Zero amount");
        require(IERC20Minimal(token).transferFrom(msg.sender, address(this), amount), "Deposit failed");
        emit TokensDeposited(msg.sender, token, amount);
    }

    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");
        require(IERC20Minimal(token).balanceOf(address(this)) >= amount, "Insufficient contract balance");
        require(IERC20Minimal(token).transfer(owner, amount), "Withdrawal failed");
        emit TokensWithdrawn(owner, token, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
        emit OwnershipTransferred(owner, newOwner);
    }

    function rescueETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20Minimal(token).balanceOf(address(this));
    }
}
