// SPDX-License-Identifier: MIT

pragma solidity ^0.8.27;

contract MockTrader {
    error MockTrader__NotEnoughBalance();

    enum Action {
        Buy,
        Sell,
        Hold,
        Wait
    }

    event TradeExecuted(Action action, address executor, uint256 timestamp);
    event FundsTransferred(uint256 amount, address recipient);

    mapping(address => uint256) public balances;

    constructor() {
        balances[msg.sender] = 1000 ether;
    }

    function executeTrade(Action _action) external {
        if (_action == Action.Buy) {
            balances[msg.sender] += 100;
        } else if (_action == Action.Sell) {
            require(balances[msg.sender] >= 100, MockTrader__NotEnoughBalance());
        }

        emit TradeExecuted(_action, msg.sender, block.timestamp);
    }

    function mockCrossChainTransfer(uint256 amount, address recipient) external {
        require(balances[msg.sender] >= amount, MockTrader__NotEnoughBalance());
        balances[msg.sender] -= amount;
        balances[recipient] += amount;
        emit FundsTransferred(amount, recipient);
    }
}
