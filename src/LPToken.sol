// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LPToken is ERC20 {
    address public immutable exchange;
    uint256 public immutable pairId;

    constructor(string memory name, string memory symbol, address _exchange, uint256 _pairId) ERC20(name, symbol) {
        exchange = _exchange;
        pairId = _pairId;
    }

    modifier onlyExchange() {
        require(msg.sender == exchange, "Only exchange can call");
        _;
    }

    function mint(address to, uint256 amount) external onlyExchange {
        _mint(to, amount);
    }

    function burnFrom(address account, uint256 amount) external onlyExchange {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }
}
