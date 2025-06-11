// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IRouterClient} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {OwnerIsCreator} from "@chainlink/contracts/src/v0.8/shared/access/OwnerIsCreator.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MagicTraderSender is OwnerIsCreator, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Action {
        Buy,
        Sell,
        Hold,
        Wait
    }

    uint256 public constant TRADING_AMOUNT = 100 ether;
    uint256 public constant GAS_LIMIT = 500_000;

    IRouterClient public router;
    IERC20 public assetToken;
    IERC20 public linkToken;
    uint64 public destChain;
    address public receiver;

    event TradeSent(Action action, address executor, bytes32 msgId);

    constructor(address _router, address _assetToken, address _linkToken, uint64 _destChain, address _receiver) {
        router = IRouterClient(_router);
        assetToken = IERC20(_assetToken);
        linkToken = IERC20(_linkToken);
        destChain = _destChain;
        receiver = _receiver;
    }

    function executeTrade(Action action) external nonReentrant onlyOwner returns (bytes32) {
        require(action == Action.Buy || action == Action.Sell, "Invalid action for sending");

        assetToken.safeTransferFrom(msg.sender, address(this), TRADING_AMOUNT);
        Client.EVM2AnyMessage memory ccipMsg = _buildMessage(action);

        uint256 fee = router.getFee(destChain, ccipMsg);
        require(linkToken.balanceOf(address(this)) >= fee, "Insufficient LINK");

        _approveToken(linkToken, address(router), fee);
        _approveToken(assetToken, address(router), TRADING_AMOUNT);

        bytes32 msgId = router.ccipSend(destChain, ccipMsg);
        emit TradeSent(action, msg.sender, msgId);
        return msgId;
    }

    function _approveToken(IERC20 token, address spender, uint256 amount) private {
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance > 0) {
            token.safeDecreaseAllowance(spender, currentAllowance);
        }
        token.safeIncreaseAllowance(spender, amount);
    }

    function _buildMessage(Action action) internal view returns (Client.EVM2AnyMessage memory) {
        Client.EVMTokenAmount[] memory amounts = new Client.EVMTokenAmount[](1);
        amounts[0] = Client.EVMTokenAmount({token: address(assetToken), amount: TRADING_AMOUNT});

        return Client.EVM2AnyMessage({
            receiver: abi.encode(receiver),
            data: abi.encode(action, msg.sender),
            tokenAmounts: amounts,
            feeToken: address(linkToken),
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: GAS_LIMIT}))
        });
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}
