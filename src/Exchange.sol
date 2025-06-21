// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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

    uint8 private constant STABLE_DECIMALS = 6;
    uint8 private constant VOLATILE_DECIMALS = 18;
    uint8 private constant FEED_DECIMALS = 8;

    event LiquidityAdded(address indexed provider, uint256 stableAmount, uint256 volatileAmount);
    event Swapped(address indexed trader, bool buyVolatile, uint256 amountIn, uint256 amountOut, uint256 minAmountOut);

    constructor(address _stableToken, address _volatileToken, address _stableFeed, address _volatileFeed) {
        stableToken = IERC20(_stableToken);
        volatileToken = IERC20(_volatileToken);
        stableFeed = AggregatorV3Interface(_stableFeed);
        volatileFeed = AggregatorV3Interface(_volatileFeed);
    }

    function addLiquidity(uint256 stableAmount, uint256 volatileAmount) external nonReentrant {
        // Use SafeERC20 for transfers
        stableToken.safeTransferFrom(msg.sender, address(this), stableAmount);
        volatileToken.safeTransferFrom(msg.sender, address(this), volatileAmount);

        stableReserve += stableAmount;
        volatileReserve += volatileAmount;
        emit LiquidityAdded(msg.sender, stableAmount, volatileAmount);
    }

    function getNormalizedPrice() public view returns (uint256) {
        (, int256 stablePrice,,,) = stableFeed.latestRoundData();
        (, int256 volatilePrice,,,) = volatileFeed.latestRoundData();

        uint256 scaledStable = uint256(stablePrice) * (10 ** (18 - FEED_DECIMALS));
        uint256 scaledVolatile = uint256(volatilePrice) * (10 ** (18 - FEED_DECIMALS));

        return (scaledVolatile * 1e18) / scaledStable;
    }

    function swap(bool buyVolatile, uint256 amountIn, uint256 minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Invalid amount");
        uint256 price = getNormalizedPrice();

        if (buyVolatile) {
            amountOut = (amountIn * 1e18 * 10 ** VOLATILE_DECIMALS) / (price * 10 ** STABLE_DECIMALS);

            require(amountOut >= minAmountOut, "Slippage too high");
            require(amountOut <= volatileReserve, "Insufficient liquidity");

            stableReserve += amountIn;
            volatileReserve -= amountOut;
            stableToken.safeTransferFrom(msg.sender, address(this), amountIn);
            volatileToken.safeTransfer(msg.sender, amountOut);
        } else {
            amountOut = (amountIn * price * 10 ** STABLE_DECIMALS) / (1e18 * 10 ** VOLATILE_DECIMALS);

            require(amountOut >= minAmountOut, "Slippage too high");
            require(amountOut <= stableReserve, "Insufficient liquidity");

            volatileReserve += amountIn;
            stableReserve -= amountOut;
            volatileToken.safeTransferFrom(msg.sender, address(this), amountIn);
            stableToken.safeTransfer(msg.sender, amountOut);
        }

        emit Swapped(msg.sender, buyVolatile, amountIn, amountOut, minAmountOut);
        return amountOut;
    }

    function getPortfolioValue() public view returns (uint256) {
        uint256 price = getNormalizedPrice();
        uint256 stableIn18 = stableReserve * (10 ** (18 - STABLE_DECIMALS));
        return stableIn18 + (volatileReserve * price) / 1e18;
    }

    function calculateTradeOutput(bool buyVolatile, uint256 amountIn) public view returns (uint256) {
        uint256 price = getNormalizedPrice();
        if (buyVolatile) {
            return (amountIn * 1e18 * 10 ** VOLATILE_DECIMALS) / (price * 10 ** STABLE_DECIMALS);
        } else {
            return (amountIn * price * 10 ** STABLE_DECIMALS) / (1e18 * 10 ** VOLATILE_DECIMALS);
        }
    }
}
