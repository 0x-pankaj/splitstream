// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice 6-decimal ERC-20 standing in for Arc's native USDC interface in local
 *         Forge tests and the demo. Mirrors USDC's 6-decimal precision so the
 *         vault's accounting is exercised exactly as it would be on Arc.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Test/demo faucet — mint arbitrary USDC to any address.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
