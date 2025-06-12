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

    constructor(address _router, address _assetToken) CCIPReceiver(_router) Ownable(msg.sender) {
        assetToken = IERC20(_assetToken);
    }

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        (Action action, address executor, uint256 amount) = abi.decode(message.data, (Action, address, uint256));

        require(assetToken.balanceOf(address(this)) >= amount, "Insufficient token balance");

        assetToken.safeTransfer(executor, amount);
        emit TradeExecuted(action, executor, amount, block.timestamp);
    }

    function depositTokens(uint256 amount) external onlyOwner {
        assetToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        assetToken.safeTransfer(owner(), amount);
    }
}
