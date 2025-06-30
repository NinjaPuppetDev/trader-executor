// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Exchange} from "./Exchange.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TradeExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Core Contracts
    address public owner;
    IERC20 public immutable stableToken;
    IERC20 public immutable volatileToken;
    Exchange public immutable exchange;

    // Events
    event TradeExecuted(bool buyVolatile, uint256 amountIn, uint256 amountOut);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokensWithdrawn(address indexed token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Unauthorized");
        _;
    }

    constructor(address _stableToken, address _volatileToken, address _exchange) {
        owner = msg.sender;
        stableToken = IERC20(_stableToken);
        volatileToken = IERC20(_volatileToken);
        exchange = Exchange(_exchange);

        // Set infinite approvals
        stableToken.approve(address(exchange), type(uint256).max);
        volatileToken.approve(address(exchange), type(uint256).max);
    }

    function executeTrade(bool buyVolatile, uint256 amountIn, uint256 minAmountOut) external nonReentrant onlyOwner {
        require(amountIn > 0, "Amount must be >0");
        require(minAmountOut > 0, "Min output must be >0");

        address tokenIn = buyVolatile ? address(stableToken) : address(volatileToken);
        address tokenOut = buyVolatile ? address(volatileToken) : address(stableToken);

        // Check balance
        require(IERC20(tokenIn).balanceOf(address(this)) >= amountIn, "Insufficient balance");

        // Execute swap
        uint256 amountOut = exchange.swap(buyVolatile, amountIn);

        // Validate output
        require(amountOut >= minAmountOut, "Insufficient output amount");

        emit TradeExecuted(buyVolatile, amountIn, amountOut);
    }

    // Withdraw tokens from contract
    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner, amount);
        emit TokensWithdrawn(token, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getTokenAddresses() external view returns (address, address) {
        return (address(stableToken), address(volatileToken));
    }
}
