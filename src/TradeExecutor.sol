// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Exchange.sol";

contract TradeExecutor {
    using SafeERC20 for IERC20;

    address public owner;
    IERC20 public immutable stableToken;
    IERC20 public immutable volatileToken;
    Exchange public immutable exchange;

    event TradeExecuted(bool buyVolatile, uint256 amountIn, uint256 amountOut, uint256 minAmountOut);
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

        // Set infinite approvals using standard approve
        stableToken.approve(address(exchange), type(uint256).max);
        volatileToken.approve(address(exchange), type(uint256).max);
    }

    function executeTrade(bool buyVolatile, uint256 amount, uint256 minAmountOut) external onlyOwner {
        uint256 amountOut;

        if (buyVolatile) {
            require(stableToken.balanceOf(address(this)) >= amount, "Insufficient stable balance");
            amountOut = exchange.swap(true, amount, minAmountOut);
        } else {
            require(volatileToken.balanceOf(address(this)) >= amount, "Insufficient volatile balance");
            amountOut = exchange.swap(false, amount, minAmountOut);
        }

        emit TradeExecuted(buyVolatile, amount, amountOut, minAmountOut);
    }

    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner, amount);
        emit TokensWithdrawn(token, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function revokeApprovals() external onlyOwner {
        stableToken.approve(address(exchange), 0);
        volatileToken.approve(address(exchange), 0);
    }

    function restoreApprovals() external onlyOwner {
        stableToken.approve(address(exchange), type(uint256).max);
        volatileToken.approve(address(exchange), type(uint256).max);
    }
}
