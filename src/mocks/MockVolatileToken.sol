// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockVolatileToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 100_000 * 10 ** 18;

    constructor()
        ERC20("Mock Volatile Token", "MVT") // Explicit arguments for ERC20
        Ownable(msg.sender) // Explicit initialization
    {
        _mint(msg.sender, 10_000 * 10 ** 18);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
