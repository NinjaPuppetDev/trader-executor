// SPDX-License-Identifier: MIT

/*//////////////////////////////////////////////////////////////
                                VERSION
//////////////////////////////////////////////////////////////*/

pragma solidity 0.8.30;

// Layout of Contract:
// version
// imports
// errors
// interfaces, libraries, contracts
// Type declarations
// State variables
// Events
// Modifiers
// Functions

// Layout of Functions:
// constructor
// receive function (if exists)
// fallback function (if exists)
// external
// public
// internal
// private
// internal & private view & pure functions
// external & public view & pure functions

/**
 * @title Exchange
 * @author David
 * @notice This contract implements a decentralized exchange for trading between a stable token and a volatile token.
 * @dev implements Chainlink price feeds for price data, OpenZeppelin's SafeERC20 for secure token transfers,
 */

/*//////////////////////////////////////////////////////////////
                                IMPORTS
//////////////////////////////////////////////////////////////*/
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LPToken} from "./LPToken.sol";

contract Exchange is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/
    error Exchange__UnauthorizedTrader();
    error Exchange__UnauthorizedRiskManager();
    error Exchange__InvalidPairId();
    error Exchange__PairInactive();
    error Exchange__MaxPairsReached();
    error Exchange__InvalidTokenAddressOrFeed();
    error Exchange__InvalidFeedAddress();
    error Exchange__PairAlreadyExists();
    error Exchange__AlreadyAuthorized();
    error Exchange__InvalidAmount();
    error Exchange__NoTokensReceived();
    error Exchange__InsufficientReserves();
    error Exchange__InvalidStablePrice();
    error Exchange__StableRoundNotComplete();
    error Exchange__StablePriceStale();
    error Exchange__InvalidVolatilePrice();
    error Exchange__VolatileRoundNotComplete();
    error Exchange__VolatilePriceStale();
    error Exchange__CannotRecoverPairTokens();
    error Exchange__AlreadyAuthorizedRiskManager();
    error Exchange__InvalidTraderAddress();

    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    struct TokenPair {
        IERC20 stableToken;
        IERC20 volatileToken;
        AggregatorV3Interface stableFeed;
        AggregatorV3Interface volatileFeed;
        uint256 stableReserve;
        uint256 volatileReserve;
        int256 currentStablePrice;
        int256 currentVolatilePrice;
        uint256 lastPriceUpdate;
        bool active;
    }

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/
    mapping(address => bool) public authorizedTraders;
    mapping(address => bool) public authorizedRiskManagers;
    mapping(uint256 => TokenPair) public tokenPairs;
    mapping(address => uint256) public tokenToPairId;
    mapping(uint256 => LPToken) public lpTokens;

    IERC20 public immutable stableToken;
    IERC20 public immutable volatileToken;

    AggregatorV3Interface public immutable stableFeed;
    AggregatorV3Interface public immutable volatileFeed;
    uint256 public pairCount;

    uint8 private constant STABLE_DECIMALS = 6;
    uint8 private constant VOLATILE_DECIMALS = 18;
    uint8 private constant FEED_DECIMALS = 8;
    uint256 public constant MAX_DATA_AGE = 1 hours;
    uint256 public constant MAX_PAIRS = 50;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event LiquidityAdded(
        uint256 indexed pairId, address indexed provider, uint256 stableAmount, uint256 volatileAmount
    );
    event Swapped(
        uint256 indexed pairId, address indexed trader, bool buyVolatile, uint256 amountIn, uint256 amountOut
    );
    event PortfolioValueUpdated(uint256 indexed pairId, uint256 totalValue);
    event PricesUpdated(uint256 indexed pairId, int256 stablePrice, int256 volatilePrice);
    event TokenPairAdded(uint256 indexed pairId, int256 stablePrice, int256 volatilePrice);
    event TokenPairDeactivated(uint256 indexed pairId);
    event TraderAuthorized(address indexed trader);
    event TraderRevoked(address indexed trader);
    event RiskManagerAuthorized(address indexed riskManager);
    event RiskManagerRevoked(address indexed riskManager);
    event LiquidityRemoved(
        uint256 indexed pairId, address indexed provider, uint256 stableAmount, uint256 volatileAmount
    );

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    // Modifiers for authorization
    modifier onlyAuthorizedTrader() {
        require(authorizedTraders[msg.sender], Exchange__UnauthorizedTrader());
        _;
    }

    modifier onlyAuthorizedRiskManager() {
        require(authorizedRiskManagers[msg.sender], Exchange__UnauthorizedRiskManager());
        _;
    }

    modifier validPair(uint256 pairId) {
        require(pairId > 0 && pairId <= pairCount, Exchange__InvalidPairId());
        require(tokenPairs[pairId].active, Exchange__PairInactive());
        _;
    }
    // =================================================

    /*//////////////////////////////////////////////////////////////
                           EXTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    constructor() Ownable(msg.sender) {
        authorizedTraders[msg.sender] = true; // Owner is authorized by default
        authorizedRiskManagers[msg.sender] = true; // Owner is authorized by default
    }

    function addTokenPair(address _stableToken, address _volatileToken, address _stableFeed, address _volatileFeed)
        external
        onlyOwner
    {
        require(pairCount < MAX_PAIRS, Exchange__MaxPairsReached());
        require(_stableToken != address(0) && _volatileFeed != address(0), Exchange__InvalidTokenAddressOrFeed());
        require(_stableFeed != address(0) && _volatileFeed != address(0), Exchange__InvalidFeedAddress());
        require(tokenToPairId[_stableToken] == 0 && tokenToPairId[_volatileToken] == 0, Exchange__PairAlreadyExists());

        uint256 newPairId = ++pairCount;
        TokenPair storage newPair = tokenPairs[newPairId];

        newPair.stableToken = IERC20(_stableToken);
        newPair.volatileToken = IERC20(_volatileToken);
        newPair.stableFeed = AggregatorV3Interface(_stableFeed);
        newPair.volatileFeed = AggregatorV3Interface(_volatileFeed);
        newPair.active = true;

        tokenToPairId[_stableToken] = newPairId;
        tokenToPairId[_volatileToken] = newPairId;

        // Safe price initialization
        _updatePrice(newPairId);

        emit TokenPairAdded(newPairId, newPair.currentStablePrice, newPair.currentVolatilePrice);
    }

    function deactivatePair(uint256 pairId) external onlyOwner {
        require(tokenPairs[pairId].active, Exchange__PairInactive());
        tokenPairs[pairId].active = false;
        emit TokenPairDeactivated(pairId);
    }

    function authorizeTrader(address trader) external onlyOwner {
        require(!authorizedTraders[trader], Exchange__AlreadyAuthorized());
        authorizedTraders[trader] = true;
        emit TraderAuthorized(trader);
    }

    function revokeTrader(address trader) external onlyOwner {
        require(authorizedTraders[trader], Exchange__UnauthorizedTrader());
        authorizedTraders[trader] = false;
        emit TraderRevoked(trader);
    }

    function authorizeRiskManager(address riskManager) external onlyOwner {
        require(!authorizedRiskManagers[riskManager], Exchange__AlreadyAuthorizedRiskManager());
        authorizedRiskManagers[riskManager] = true;
        emit RiskManagerAuthorized(riskManager);
    }

    function revokeRiskManager(address riskManager) external onlyOwner {
        require(authorizedRiskManagers[riskManager], Exchange__UnauthorizedRiskManager());
        authorizedRiskManagers[riskManager] = false;
        emit RiskManagerRevoked(riskManager);
    }

    /**
     * @notice Core functions, swapping tokens between stable and volatile
     * @param pairId The ID of the token pair to swap
     * @param buyVolatile If true, swap stable for volatile; if false, swap volatile for stable
     * @param amountIn The amount of input tokens to swap
     * @return amountOut The amount of output tokens received after the swap
     * @dev This function performs a swap between stable and volatile tokens based on the reserves and current prices.
     */
    function swap(uint256 pairId, bool buyVolatile, uint256 amountIn)
        external
        nonReentrant
        onlyAuthorizedTrader
        validPair(pairId)
        returns (uint256 amountOut)
    {
        TokenPair storage pair = tokenPairs[pairId];
        require(amountIn > 0, Exchange__InvalidAmount());

        IERC20 tokenIn = buyVolatile ? pair.stableToken : pair.volatileToken;
        IERC20 tokenOut = buyVolatile ? pair.volatileToken : pair.stableToken;

        // Measure actual tokens received (accounts for fees, etc.)
        uint256 balanceBefore = tokenIn.balanceOf(address(this));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 balanceAfter = tokenIn.balanceOf(address(this));
        uint256 actualAmountIn = balanceAfter - balanceBefore;
        require(actualAmountIn > 0, Exchange__NoTokensReceived());

        // Calculate output amount with overflow protection
        if (buyVolatile) {
            amountOut = (actualAmountIn * pair.volatileReserve) / (pair.stableReserve + actualAmountIn);

            // Explicit reserve checks (security)
            require(amountOut > 0, Exchange__InvalidAmount());
            require(amountOut <= pair.volatileReserve, Exchange__InsufficientReserves());

            // aderyn-fp-next-line(reentrancy-state-change)
            pair.stableReserve += actualAmountIn;
            // aderyn-fp-next-line(reentrancy-state-change)
            pair.volatileReserve -= amountOut;
        } else {
            amountOut = (actualAmountIn * pair.stableReserve) / (pair.volatileReserve + actualAmountIn);

            // Explicit reserve checks (security)
            require(amountOut > 0, Exchange__InvalidAmount());
            require(amountOut <= pair.stableReserve, Exchange__InsufficientReserves());

            // aderyn-fp-next-line(reentrancy-state-change)
            pair.volatileReserve += actualAmountIn;
            // aderyn-fp-next-line(reentrancy-state-change)
            pair.stableReserve -= amountOut;
        }

        // Send output tokens - last operation
        tokenOut.safeTransfer(msg.sender, amountOut);

        emit Swapped(pairId, msg.sender, buyVolatile, actualAmountIn, amountOut);
        emit PortfolioValueUpdated(pairId, getPortfolioValue(pairId));
        return amountOut;
    }

    /**
     * @notice Swaps tokens for a specific trader, used by risk managers
     * @param pairId The ID of the token pair to swap
     * @param trader The address of the trader to swap for
     * @param buyVolatile If true, swap stable for volatile; if false, swap volatile for stable
     * @param amountIn The amount of input tokens to swap
     * @return amountOut The amount of output tokens received after the swap
     * @dev This function allows risk managers to perform swaps on behalf of traders, ensuring they have the necessary permissions.
     */
    function swapFor(uint256 pairId, address trader, bool buyVolatile, uint256 amountIn)
        external
        nonReentrant
        onlyAuthorizedRiskManager
        validPair(pairId)
        returns (uint256 amountOut)
    {
        TokenPair storage pair = tokenPairs[pairId];
        require(amountIn > 0, Exchange__InvalidAmount());
        require(trader != address(0), Exchange__InvalidTraderAddress());

        // Use pair-specific tokens
        IERC20 tokenIn = buyVolatile ? pair.stableToken : pair.volatileToken;
        IERC20 tokenOut = buyVolatile ? pair.volatileToken : pair.stableToken;

        // 1. PREPARE STATE - cache all values
        uint256 stableReserveCache = pair.stableReserve;
        uint256 volatileReserveCache = pair.volatileReserve;
        uint256 actualAmountIn;

        {
            // aderyn-fp-next-line(reentrancy-state-change)
            uint256 balanceBefore = tokenIn.balanceOf(address(this));
            tokenIn.safeTransferFrom(trader, address(this), amountIn);
            // aderyn-fp-next-line(reentrancy-state-change)
            uint256 balanceAfter = tokenIn.balanceOf(address(this));
            actualAmountIn = balanceAfter - balanceBefore;
            require(actualAmountIn > 0, Exchange__NoTokensReceived());
        }

        // 2. PERFORM CALCULATIONS
        if (buyVolatile) {
            amountOut = (actualAmountIn * volatileReserveCache) / (stableReserveCache + actualAmountIn);
            require(amountOut > 0, Exchange__InvalidAmount());
            require(amountOut <= volatileReserveCache, Exchange__InsufficientReserves());

            // Update reserves in cache
            stableReserveCache += actualAmountIn;
            volatileReserveCache -= amountOut;
        } else {
            amountOut = (actualAmountIn * stableReserveCache) / (volatileReserveCache + actualAmountIn);
            require(amountOut > 0, Exchange__InvalidAmount());
            require(amountOut <= stableReserveCache, Exchange__InsufficientReserves());

            // Update reserves in cache
            volatileReserveCache += actualAmountIn;
            stableReserveCache -= amountOut;
        }

        // 3. UPDATE STATE - single assignment
        pair.stableReserve = stableReserveCache;
        pair.volatileReserve = volatileReserveCache;

        // 4. INTERACTION - final external call
        tokenOut.safeTransfer(trader, amountOut);

        emit Swapped(pairId, trader, buyVolatile, actualAmountIn, amountOut);
        emit PortfolioValueUpdated(pairId, getPortfolioValue(pairId));
        return amountOut;
    }
    /**
     * @notice Adds liquidity to a specific token pair
     * @param pairId The ID of the token pair to add liquidity to
     * @param stableAmount The amount of stable tokens to add
     * @param volatileAmount The amount of volatile tokens to add
     */

    function addLiquidity(uint256 pairId, uint256 stableAmount, uint256 volatileAmount)
        external
        nonReentrant
        validPair(pairId)
    {
        TokenPair storage pair = tokenPairs[pairId];
        require(stableAmount > 0 && volatileAmount > 0, Exchange__InvalidAmount());

        pair.stableToken.safeTransferFrom(msg.sender, address(this), stableAmount);
        pair.volatileToken.safeTransferFrom(msg.sender, address(this), volatileAmount);

        pair.stableReserve += stableAmount;
        pair.volatileReserve += volatileAmount;

        emit LiquidityAdded(pairId, msg.sender, stableAmount, volatileAmount);
        emit PortfolioValueUpdated(pairId, getPortfolioValue(pairId));
    }

    /**
     * @notice Removes liquidity from a specific token pair
     * @param pairId The ID of the token pair to remove liquidity from
     * @param liquidityShare The percentage of liquidity to remove (1e18 precision, e
     * @dev This function allows users to remove a percentage of their liquidity from a token pair.
     */
    function removeLiquidity(
        uint256 pairId,
        uint256 liquidityShare // Percentage with 1e18 precision (e.g., 10% = 0.1e18)
    ) external nonReentrant validPair(pairId) {
        require(liquidityShare <= 1e18, "Invalid share");

        TokenPair storage pair = tokenPairs[pairId];
        uint256 stableAmount = (pair.stableReserve * liquidityShare) / 1e18;
        uint256 volatileAmount = (pair.volatileReserve * liquidityShare) / 1e18;

        pair.stableReserve -= stableAmount;
        pair.volatileReserve -= volatileAmount;

        pair.stableToken.safeTransfer(msg.sender, stableAmount);
        pair.volatileToken.safeTransfer(msg.sender, volatileAmount);

        emit LiquidityRemoved(pairId, msg.sender, stableAmount, volatileAmount);
        emit PortfolioValueUpdated(pairId, getPortfolioValue(pairId));
    }

    function transferLP(uint256 pairId, address to, uint256 amount) external {
        LPToken lp = lpTokens[pairId];
        require(lp.balanceOf(msg.sender) >= amount, Exchange__InvalidAmount());
        lp.transfer(to, amount);
    }

    function updatePrice(uint256 pairId) external validPair(pairId) {
        _updatePrice(pairId);
    }

    function _updatePrice(uint256 pairId) internal {
        TokenPair storage pair = tokenPairs[pairId];

        (, int256 stablePrice,, uint256 stableUpdatedAt, uint80 stableAnsweredInRound) =
            pair.stableFeed.latestRoundData();
        require(stablePrice > 0, Exchange__InvalidStablePrice());
        require(stableUpdatedAt > 0, Exchange__StableRoundNotComplete());
        require(stableAnsweredInRound >= stableAnsweredInRound, Exchange__StablePriceStale());
        require(block.timestamp - stableUpdatedAt <= MAX_DATA_AGE, Exchange__StablePriceStale());

        (, int256 volatilePrice,, uint256 volatileUpdatedAt, uint80 volatileAnsweredInRound) =
            pair.volatileFeed.latestRoundData();
        require(volatilePrice > 0, Exchange__InvalidVolatilePrice());
        require(volatileUpdatedAt > 0, Exchange__VolatileRoundNotComplete());
        require(volatileAnsweredInRound >= volatileAnsweredInRound, Exchange__VolatilePriceStale());
        require(block.timestamp - volatileUpdatedAt <= MAX_DATA_AGE, Exchange__VolatilePriceStale());

        pair.currentStablePrice = stablePrice;
        pair.currentVolatilePrice = volatilePrice;
        pair.lastPriceUpdate = block.timestamp;

        emit PricesUpdated(pairId, stablePrice, volatilePrice);
    }

    /*//////////////////////////////////////////////////////////////
                                GETTERS
    //////////////////////////////////////////////////////////////*/

    function getPortfolioValue(uint256 pairId) public view validPair(pairId) returns (uint256) {
        TokenPair storage pair = tokenPairs[pairId];
        uint256 stableValue = (uint256(pair.currentStablePrice)) * pair.stableReserve * 10 ** (18 - STABLE_DECIMALS);
        uint256 volatileValue =
            (uint256(pair.currentVolatilePrice)) * pair.volatileReserve * 10 ** (18 - VOLATILE_DECIMALS);
        return (stableValue + volatileValue) / 10 ** FEED_DECIMALS;
    }

    function getReserves(uint256 pairId) public view validPair(pairId) returns (uint256, uint256) {
        TokenPair storage pair = tokenPairs[pairId];
        return (pair.stableReserve, pair.volatileReserve);
    }

    function getReserveBasedPrice(uint256 pairId) public view validPair(pairId) returns (uint256) {
        TokenPair storage pair = tokenPairs[pairId];
        if (pair.stableReserve == 0 || pair.volatileReserve == 0) return 0;
        return (pair.stableReserve * 1e18) / pair.volatileReserve;
    }

    function getTokenAddresses(uint256 pairId) external view validPair(pairId) returns (address, address) {
        TokenPair storage pair = tokenPairs[pairId];
        return (address(pair.stableToken), address(pair.volatileToken));
    }

    /**
     * @notice Allows the owner to recover tokens that are not part of any trading pair
     * @param pairId The ID of the token pair to check against
     * @param tokenAddress The address of the token to recover
     * @param amount The amount of tokens to recover
     * @dev This function can be used to recover tokens that were mistakenly sent to the contract or are not part of any trading pair.
     */
    function recoverTokens(uint256 pairId, address tokenAddress, uint256 amount) external onlyOwner {
        TokenPair storage pair = tokenPairs[pairId];
        require(
            tokenAddress != address(pair.stableToken) && tokenAddress != address(pair.volatileToken),
            Exchange__CannotRecoverPairTokens()
        );
        IERC20(tokenAddress).safeTransfer(owner(), amount);
    }
}
