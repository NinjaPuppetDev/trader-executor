// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Exchange} from "./Exchange.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RiskManager} from "./RiskManager.sol";

contract TradeExecutor is ReentrancyGuard {
    error TradeExecutor__UnauthorizedOwner();
    error TradeExecutor__UnauthorizedRiskManger();
    error TradeExecutor__AmountMustBeMorethanZero();
    error TradeExecutor__MinAmountOutMustBeMorethanZero();
    error TradeExecutor__InsufficientBalance();

    using SafeERC20 for IERC20;

    // Core Contracts
    address public owner;
    Exchange public immutable exchange;
    RiskManager public riskManager;
    uint256 public immutable pairId;

    // Token addresses (now derived from Exchange)
    IERC20 public stableToken;
    IERC20 public volatileToken;

    // Mappings
    mapping(bytes32 => uint256) public entryPrices;

    // Events
    event TradeExecuted(bool indexed buyVolatile, uint256 amountIn, uint256 amountOut);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TokensWithdrawn(address indexed token, uint256 amount);
    event PositionOpened(
        bytes32 indexed positionId, address indexed trader, bool isLong, uint256 amount, uint256 entryPrice
    );

    modifier onlyOwner() {
        require(msg.sender == owner, TradeExecutor__UnauthorizedOwner());
        _;
    }

    constructor(address _exchange, uint256 _pairId) {
        owner = msg.sender;
        exchange = Exchange(_exchange);
        pairId = _pairId;

        (address stableAddr, address volatileAddr) = exchange.getTokenAddresses(_pairId);
        require(stableAddr != address(0) && volatileAddr != address(0), "Invalid token addresses");

        stableToken = IERC20(stableAddr);
        volatileToken = IERC20(volatileAddr);

        // Set safe approvals
        stableToken.safeIncreaseAllowance(address(exchange), type(uint256).max);
        volatileToken.safeIncreaseAllowance(address(exchange), type(uint256).max);
    }

    function verifyInitialization() external view {
        require(address(stableToken) != address(0), "Stable token not initialized");
        require(address(volatileToken) != address(0), "Volatile token not initialized");
    }

    function setRiskManager(address _riskManager) external onlyOwner {
        require(_riskManager != address(0), TradeExecutor__UnauthorizedRiskManger());
        riskManager = RiskManager(_riskManager);
    }

    function executeTrade(bool buyVolatile, uint256 amountIn, uint256 minAmountOut) external nonReentrant onlyOwner {
        require(amountIn > 0, TradeExecutor__AmountMustBeMorethanZero());
        require(minAmountOut > 0, TradeExecutor__MinAmountOutMustBeMorethanZero());

        IERC20 tokenIn = buyVolatile ? stableToken : volatileToken;

        // Check balance
        require(tokenIn.balanceOf(address(this)) >= amountIn, TradeExecutor__InsufficientBalance());

        // Execute swap
        uint256 amountOut = exchange.swap(pairId, buyVolatile, amountIn);

        // Validate output
        require(amountOut >= minAmountOut, TradeExecutor__InsufficientBalance());

        // Get entry price from exchange
        uint256 entryPrice = exchange.getReserveBasedPrice(pairId);

        // Generate position ID
        // q can this timestamp be manipulated by a miner?
        bytes32 positionId = keccak256(abi.encodePacked(owner, block.timestamp, amountOut));

        // Store entry price
        entryPrices[positionId] = entryPrice;

        emit PositionOpened(positionId, owner, buyVolatile, amountOut, entryPrice);
        emit TradeExecuted(buyVolatile, amountIn, amountOut);
    }

    function getEntryPrice(bytes32 positionId) external view returns (uint256) {
        return entryPrices[positionId];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), TradeExecutor__UnauthorizedOwner());
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getStableToken() external view returns (address) {
        return address(stableToken);
    }

    function getVolatileToken() external view returns (address) {
        return address(volatileToken);
    }

    function getExchange() external view returns (address) {
        return address(exchange);
    }
}
