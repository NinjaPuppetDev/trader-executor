// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

contract MockTrader {
    error MockTrader__NotEnoughBalance();

    uint256 public constant TRADING_AMOUNT = 100 ether;

    enum Action {
        Buy,
        Sell,
        Hold,
        Wait
    }

    event TradeExecuted(Action action, address executor, uint256 timestamp);

    mapping(address => uint256) public balances;

    constructor() {
        balances[msg.sender] = 1000 ether;
    }

    function executeTrade(Action _action) external {
        if (_action == Action.Buy) {
            balances[msg.sender] += TRADING_AMOUNT;
        } else if (_action == Action.Sell) {
            require(balances[msg.sender] >= TRADING_AMOUNT, MockTrader__NotEnoughBalance());
        }

        emit TradeExecuted(_action, msg.sender, block.timestamp);
    }
}
