// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUSYCTeller} from "../interfaces/IUSYCTeller.sol";

/**
 * @title MockUSYCToken
 * @notice 6-decimal stand-in for the USYC yield share token.
 */
contract MockUSYCToken is ERC20 {
    address public immutable teller;

    constructor(address _teller) ERC20("Mock USYC", "USYC") {
        teller = _teller;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == teller, "only teller");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == teller, "only teller");
        _burn(from, amount);
    }
}

/**
 * @title MockUSYCTeller
 * @notice Deterministic stand-in for Circle's allowlisted USYC Teller on Arc.
 *
 * Models the real surface (deposit USDC -> mint USYC; redeem USYC -> return USDC)
 * with a configurable yield in basis points applied on redemption, so tests can
 * exercise the vault's sweep/unwind lifecycle and prove yield accrues. The real
 * Teller (0x9fdF…) is gated behind Entitlements allowlisting; this mock lets the
 * end-to-end demo run without that 24-48h approval.
 */
contract MockUSYCTeller is IUSYCTeller {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    MockUSYCToken public immutable usycToken;

    /// @notice Yield applied on redemption, in basis points (e.g. 500 = +5%).
    uint256 public yieldBps;

    constructor(IERC20 _usdc, uint256 _yieldBps) {
        usdc = _usdc;
        usycToken = new MockUSYCToken(address(this));
        yieldBps = _yieldBps;
    }

    function setYieldBps(uint256 _yieldBps) external {
        yieldBps = _yieldBps;
    }

    /// @inheritdoc IUSYCTeller
    function deposit(uint256 usdcAmount) external returns (uint256 usycMinted) {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usycMinted = usdcAmount; // 1:1 share price at deposit
        usycToken.mint(msg.sender, usycMinted);
    }

    /// @inheritdoc IUSYCTeller
    function redeem(uint256 usycAmount) external returns (uint256 usdcReturned) {
        usycToken.burn(msg.sender, usycAmount);
        usdcReturned = usycAmount + (usycAmount * yieldBps) / 10_000;
        usdc.safeTransfer(msg.sender, usdcReturned);
    }

    /// @inheritdoc IUSYCTeller
    function usyc() external view returns (address) {
        return address(usycToken);
    }
}
