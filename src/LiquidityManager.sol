// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Exchange} from "./Exchange.sol";
import {TradeExecutor} from "./TradeExecutor.sol";
import {LPToken} from "./LPToken.sol";

contract LiquidityManager is Ownable {
    Exchange public immutable exchange;

    event TraderFunded(address indexed trader, uint256 indexed pairId, uint256 stableAmount, uint256 volatileAmount);

    event LiquidityAdded(uint256 indexed pairId, uint256 stableAmount, uint256 volatileAmount);

    event LiquidityRemoved(uint256 indexed pairId, uint256 stableAmount, uint256 volatileAmount);

    constructor(address _exchange) Ownable(msg.sender) {
        exchange = Exchange(_exchange);
    }

    // Fund new trader executor and optionally add liquidity
    function fundNewTraderExecutor(
        address _exchange, // Exchange address
        uint256 _pairId, // Trading pair ID
        uint256 _initialStable, // Initial funding (stable)
        uint256 _initialVolatile, // Initial funding (volatile)
        uint256 _liquidityStable, // Liquidity to add (stable)
        uint256 _liquidityVolatile // Liquidity to add (volatile)
    ) external onlyOwner {
        // Deploy new trader executor
        TradeExecutor trader = new TradeExecutor(_exchange, _pairId);

        // Fund trader with initial capital
        _fundTrader(trader, _pairId, _initialStable, _initialVolatile);

        // Add liquidity to exchange if specified
        if (_liquidityStable > 0 && _liquidityVolatile > 0) {
            _addLiquidity(_pairId, _liquidityStable, _liquidityVolatile);
        }
    }

    // Add liquidity to exchange
    function addLiquidity(uint256 _pairId, uint256 _stableAmount, uint256 _volatileAmount) external onlyOwner {
        _addLiquidity(_pairId, _stableAmount, _volatileAmount);
    }

    // Remove liquidity from exchange
    function removeLiquidity(uint256 _pairId, uint256 _liquidity) external onlyOwner {
        (address stableAddr, address volatileAddr) = exchange.getTokenAddresses(_pairId);
        LPToken lpToken = exchange.lpTokens(_pairId);

        // Get reserve shares
        (uint256 stableReserve, uint256 volatileReserve) = exchange.getReserves(_pairId);
        uint256 totalSupply = lpToken.totalSupply();

        // Calculate amounts to withdraw
        uint256 stableAmount = (stableReserve * _liquidity) / totalSupply;
        uint256 volatileAmount = (volatileReserve * _liquidity) / totalSupply;

        // Remove liquidity
        lpToken.approve(address(exchange), _liquidity);
        exchange.removeLiquidity(_pairId, _liquidity);

        // Transfer tokens back to owner
        IERC20(stableAddr).transfer(owner(), stableAmount);
        IERC20(volatileAddr).transfer(owner(), volatileAmount);

        emit LiquidityRemoved(_pairId, stableAmount, volatileAmount);
    }

    // ================= INTERNAL FUNCTIONS ================= //
    function _fundTrader(TradeExecutor _trader, uint256 _pairId, uint256 _stableAmount, uint256 _volatileAmount)
        internal
    {
        (address stableAddr, address volatileAddr) = exchange.getTokenAddresses(_pairId);

        // Transfer funds to trader
        IERC20(stableAddr).transfer(address(_trader), _stableAmount);
        IERC20(volatileAddr).transfer(address(_trader), _volatileAmount);

        // Transfer trader ownership to contract owner
        _trader.transferOwnership(owner());

        emit TraderFunded(address(_trader), _pairId, _stableAmount, _volatileAmount);
    }

    function _addLiquidity(uint256 _pairId, uint256 _stableAmount, uint256 _volatileAmount) internal {
        (address stableAddr, address volatileAddr) = exchange.getTokenAddresses(_pairId);

        // Transfer tokens to this contract
        IERC20 stableToken = IERC20(stableAddr);
        IERC20 volatileToken = IERC20(volatileAddr);

        stableToken.transferFrom(owner(), address(this), _stableAmount);
        volatileToken.transferFrom(owner(), address(this), _volatileAmount);

        // Approve and add liquidity
        stableToken.approve(address(exchange), _stableAmount);
        volatileToken.approve(address(exchange), _volatileAmount);
        exchange.addLiquidity(_pairId, _stableAmount, _volatileAmount);

        emit LiquidityAdded(_pairId, _stableAmount, _volatileAmount);
    }
}
