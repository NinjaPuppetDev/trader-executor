// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {CCIPReceiver} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MagicTraderReceiver is CCIPReceiver, Ownable {
    using SafeERC20 for IERC20;

    event TradeExecuted(Action action, address executor, uint256 amount, uint256 timestamp);

    enum Action {
        Buy,
        Sell,
        Hold,
        Wait
    }

    IERC20 public assetToken;

    // In MagicTraderReceiver.sol
    constructor(address _router, address _assetToken) CCIPReceiver(_router) Ownable(msg.sender) {
        assetToken = IERC20(_assetToken);
    }

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        (Action action, address executor) = abi.decode(message.data, (Action, address));

        // Add token validation
        require(message.destTokenAmounts.length > 0, "No tokens received");
        require(message.destTokenAmounts[0].token == address(assetToken), "Invalid token");

        uint256 amount = message.destTokenAmounts[0].amount;

        // Transfer tokens to executor
        assetToken.safeTransfer(executor, amount);

        emit TradeExecuted(action, executor, amount, block.timestamp);
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
