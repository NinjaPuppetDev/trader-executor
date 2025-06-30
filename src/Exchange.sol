// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract Exchange is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stableToken;
    IERC20 public immutable volatileToken;

    uint256 public stableReserve;
    uint256 public volatileReserve;

    AggregatorV3Interface public immutable stableFeed;
    AggregatorV3Interface public immutable volatileFeed;

    // State variables for prices
    int256 public currentVolatilePrice;
    int256 public currentStablePrice;
    uint256 public lastPriceUpdate;

    uint8 private constant STABLE_DECIMALS = 6;
    uint8 private constant VOLATILE_DECIMALS = 18;
    uint8 private constant FEED_DECIMALS = 8;
    uint256 public constant MAX_DATA_AGE = 1 hours;

    event LiquidityAdded(address indexed provider, uint256 stableAmount, uint256 volatileAmount);
    event Swapped(address indexed trader, bool buyVolatile, uint256 amountIn, uint256 amountOut);
    event PortfolioValueUpdated(uint256 totalValue);

    constructor(address _stableToken, address _volatileToken, address _stableFeed, address _volatileFeed) {
        stableToken = IERC20(_stableToken);
        volatileToken = IERC20(_volatileToken);
        stableFeed = AggregatorV3Interface(_stableFeed);
        volatileFeed = AggregatorV3Interface(_volatileFeed);

        // Get prices first
        (, int256 stablePrice,,,) = stableFeed.latestRoundData();
        (, int256 volatilePrice,,,) = volatileFeed.latestRoundData();

        // Validate prices
        require(stablePrice > 0, "Invalid initial stable price");
        require(volatilePrice > 0, "Invalid initial volatile price");

        // Then update state
        currentStablePrice = stablePrice;
        currentVolatilePrice = volatilePrice;
        lastPriceUpdate = block.timestamp;
    }

    function addLiquidity(uint256 stableAmount, uint256 volatileAmount) external nonReentrant {
        stableToken.safeTransferFrom(msg.sender, address(this), stableAmount);
        volatileToken.safeTransferFrom(msg.sender, address(this), volatileAmount);

        stableReserve += stableAmount;
        volatileReserve += volatileAmount;

        emit LiquidityAdded(msg.sender, stableAmount, volatileAmount);
        emit PortfolioValueUpdated(getPortfolioValue());
    }

    // Proper decimal scaling for portfolio valuation
    function getPortfolioValue() public view returns (uint256) {
        require(block.timestamp - lastPriceUpdate <= MAX_DATA_AGE, "Prices stale");

        // Convert prices to 18 decimals
        uint256 scaledStablePrice = uint256(currentStablePrice) * (10 ** (18 - FEED_DECIMALS));
        uint256 scaledVolatilePrice = uint256(currentVolatilePrice) * (10 ** (18 - FEED_DECIMALS));

        // Convert reserves to 18 decimals
        uint256 stableValue = stableReserve * (10 ** (18 - STABLE_DECIMALS)) * scaledStablePrice;
        uint256 volatileValue = volatileReserve * scaledVolatilePrice;

        // Return total value in stable token terms (18 decimals)
        return (stableValue + volatileValue) / 1e18;
    }

    function swap(bool buyVolatile, uint256 amountIn) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Invalid amount");

        if (buyVolatile) {
            amountOut = (amountIn * volatileReserve) / (stableReserve + amountIn);
            require(amountOut > 0, "Output too small");
            stableReserve += amountIn;
            volatileReserve -= amountOut;
            stableToken.safeTransferFrom(msg.sender, address(this), amountIn);
            volatileToken.safeTransfer(msg.sender, amountOut);
        } else {
            amountOut = (amountIn * stableReserve) / (volatileReserve + amountIn);
            require(amountOut > 0, "Output too small");
            volatileReserve += amountIn;
            stableReserve -= amountOut;
            volatileToken.safeTransferFrom(msg.sender, address(this), amountIn);
            stableToken.safeTransfer(msg.sender, amountOut);
        }

        emit Swapped(msg.sender, buyVolatile, amountIn, amountOut);
        emit PortfolioValueUpdated(getPortfolioValue());
        return amountOut;
    }

    function updateVolatilePrice(int256 _newPrice) external {
        require(_newPrice > 0, "Invalid price");
        currentVolatilePrice = _newPrice;
        lastPriceUpdate = block.timestamp;
    }

    function updateStablePrice(int256 _newPrice) external {
        require(_newPrice > 0, "Invalid price");
        currentStablePrice = _newPrice;
        lastPriceUpdate = block.timestamp;
    }

    function getReserves() external view returns (uint256 stable, uint256 volatile) {
        return (stableReserve, volatileReserve);
    }

    function getReserveBasedPrice() public view returns (uint256) {
        if (stableReserve == 0 || volatileReserve == 0) return 0;
        return (stableReserve * 1e18) / volatileReserve;
    }
}
