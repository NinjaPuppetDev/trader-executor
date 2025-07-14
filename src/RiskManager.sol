// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {TradeExecutor} from "./TradeExecutor.sol";
import {Exchange} from "./Exchange.sol";

contract RiskManager is Ownable {
    error RiskManager__UnauthorizedExecutor();
    error RiskManager__InvalidPosition();
    error RiskManager__SwapFailed();
    error RiskManager__PositionAlreadyExists();
    error RiskManager__InvalidPositionId();

    // Core references
    Exchange public immutable exchange;
    TradeExecutor public immutable tradeExecutor;
    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable pairId;

    // Position management
    struct Position {
        address trader;
        bool isLong;
        uint256 amount;
        uint24 stopLoss;
        uint24 takeProfit;
        uint32 lastUpdated;
        uint256 entryPrice;
    }

    mapping(bytes32 => Position) public positions;
    mapping(address => bool) public authorizedExecutors;

    // Events
    event PositionOpened(bytes32 indexed positionId, address trader, bool isLong, uint256 amount, uint256 entryPrice);
    event PositionClosed(bytes32 indexed positionId, string reason, uint256 amountOut);
    event RiskParametersUpdated(bytes32 indexed positionId, uint24 stopLoss, uint24 takeProfit);

    constructor(address _exchange, address _priceFeed, address initialOwner, address _tradeExecutor, uint256 _pairId)
        Ownable(initialOwner)
    {
        exchange = Exchange(_exchange);
        priceFeed = AggregatorV3Interface(_priceFeed);
        tradeExecutor = TradeExecutor(_tradeExecutor);
        pairId = _pairId;
        authorizedExecutors[msg.sender] = true;
    }

    modifier onlyExecutor() {
        require(authorizedExecutors[msg.sender], "Unauthorized executor");
        _;
    }

    function addExecutor(address executor) external onlyOwner {
        authorizedExecutors[executor] = true;
    }

    function removeExecutor(address executor) external onlyOwner {
        authorizedExecutors[executor] = false;
    }

    function openPositionWithParams(
        address trader,
        bool isLong,
        uint256 amount,
        uint24 stopLoss,
        uint24 takeProfit,
        uint256 entryPrice,
        bytes32 positionId
    ) external onlyExecutor {
        require(stopLoss >= 50 && stopLoss <= 3000, "SL: 0.5-30%");
        require(takeProfit >= stopLoss * 2, "TP < 2x SL");

        // Validate positionId
        if (positionId == bytes32(0)) revert RiskManager__InvalidPositionId();
        if (positions[positionId].trader != address(0)) revert RiskManager__PositionAlreadyExists();

        positions[positionId] = Position({
            trader: trader,
            isLong: isLong,
            amount: amount,
            stopLoss: stopLoss,
            takeProfit: takeProfit,
            lastUpdated: uint32(block.timestamp),
            entryPrice: entryPrice
        });

        emit PositionOpened(positionId, trader, isLong, amount, entryPrice);
    }

    function updateRiskParameters(bytes32 positionId, uint24 newStopLoss, uint24 newTakeProfit) external onlyExecutor {
        Position storage position = positions[positionId];
        // FIXED: Use revert with custom error
        if (position.trader == address(0)) {
            revert RiskManager__InvalidPosition();
        }

        position.stopLoss = newStopLoss;
        position.takeProfit = newTakeProfit;
        position.lastUpdated = uint32(block.timestamp);

        emit RiskParametersUpdated(positionId, newStopLoss, newTakeProfit);
    }

    function executeRiskManagementTrade(bytes32 positionId) external onlyExecutor {
        Position memory position = positions[positionId];
        if (position.trader == address(0)) revert RiskManager__InvalidPosition();

        (, int256 rawPrice,,,) = priceFeed.latestRoundData();
        uint256 currentPrice = uint256(rawPrice) * 1e10;

        bool shouldClose = false;
        string memory reason;
        uint256 amountOut = 0;

        if (position.isLong) {
            if (currentPrice <= position.entryPrice * (10000 - position.stopLoss) / 10000) {
                shouldClose = true;
                reason = "SL-LONG";
            } else if (currentPrice >= position.entryPrice * (10000 + position.takeProfit) / 10000) {
                shouldClose = true;
                reason = "TP-LONG";
            }
        } else {
            if (currentPrice >= position.entryPrice * (10000 + position.stopLoss) / 10000) {
                shouldClose = true;
                reason = "SL-SHORT";
            } else if (currentPrice <= position.entryPrice * (10000 - position.takeProfit) / 10000) {
                shouldClose = true;
                reason = "TP-SHORT";
            }
        }

        if (shouldClose) {
            amountOut = _closePosition(positionId, position, reason);
            emit PositionClosed(positionId, reason, amountOut);
        }
    }

    function _closePosition(bytes32 positionId, Position memory position, string memory reason)
        internal
        returns (uint256 amountOut)
    {
        bool buyVolatile = !position.isLong;
        amountOut = exchange.swapFor(pairId, position.trader, buyVolatile, position.amount);
        if (amountOut == 0) revert RiskManager__SwapFailed();
        delete positions[positionId];
        return amountOut;
    }
}
