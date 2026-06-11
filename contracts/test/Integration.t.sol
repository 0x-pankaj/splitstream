// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArcaneTreasuryVault} from "../src/ArcaneTreasuryVault.sol";
import {ArcaneComplianceGuard} from "../src/ArcaneComplianceGuard.sol";
import {IComplianceGuard} from "../src/interfaces/IComplianceGuard.sol";
import {IUSYCTeller} from "../src/interfaces/IUSYCTeller.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {MockUSYCTeller} from "../src/mocks/MockUSYCTeller.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice End-to-end lifecycle: a platform funds the vault, the relayer settles
 *         a batch of instant-path payouts to several whitelisted recipients
 *         across the day, idle float is swept to USYC for yield, then unwound to
 *         satisfy a final payout — mirroring a real treasury day.
 */
contract IntegrationTest is Test {
    ArcaneTreasuryVault internal vault;
    ArcaneComplianceGuard internal guard;
    MockUSDC internal usdc;
    MockUSYCTeller internal teller;

    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal platform = makeAddr("platform");
    address internal solver = makeAddr("solver");
    address internal tenant = makeAddr("acme-marketplace");

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        guard = new ArcaneComplianceGuard(owner);
        vm.prank(owner);
        vault = new ArcaneTreasuryVault(owner, IERC20(address(usdc)), guard, relayer, platform);
        teller = new MockUSYCTeller(IERC20(address(usdc)), 300); // +3%
        usdc.mint(address(teller), 10_000_000_000); // $10k yield reserve buffer

        vm.startPrank(owner);
        guard.setAuthorizedCaller(address(vault), true);
        guard.setDailyVolumeLimit(tenant, 500_000_000_000); // $500k/day
        vault.setSolverWhitelisted(solver, true);
        vault.setUsycTeller(IUSYCTeller(address(teller)));
        vm.stopPrank();

        usdc.mint(tenant, 300_000_000_000); // $300k
        vm.startPrank(tenant);
        usdc.approve(address(vault), 300_000_000_000);
        vault.depositUSDC(300_000_000_000);
        vm.stopPrank();
    }

    function test_fullTreasuryDay() public {
        // Whitelist 5 creator recipients.
        for (uint256 i = 0; i < 5; i++) {
            bytes32 key = keccak256(abi.encodePacked("creator", i));
            vm.prank(owner);
            guard.setRecipientWhitelisted(tenant, key, true);
        }

        // Settle 5 instant-path payouts of $250 each (+0.5% conv, +$0.01 net).
        uint256 totalGross;
        for (uint256 i = 0; i < 5; i++) {
            bytes32 key = keccak256(abi.encodePacked("creator", i));
            uint256 gross = 250_000_000;
            uint256 conv = (gross * 50) / 10_000;
            vm.prank(relayer);
            vault.executeIntent(
                keccak256(abi.encodePacked("batch1", i)), tenant, key, solver, gross, 10_000, conv
            );
            totalGross += gross;
        }
        assertEq(usdc.balanceOf(solver), totalGross, "all 5 creators paid via solver");
        assertEq(guard.currentWindowVolume(tenant), totalGross, "velocity tracked");

        // Sweep idle float into USYC, then unwind it later in the day.
        uint256 idle = vault.idleBalance();
        vm.prank(owner);
        vault.sweepToYield(100_000_000_000); // $100k
        assertEq(vault.yieldPrincipal(), 100_000_000_000);

        vm.warp(block.timestamp + 6 hours);
        vm.prank(owner);
        vault.unwindYield(100_000_000_000);
        assertGt(usdc.balanceOf(address(vault)), idle, "yield accrued back to the vault");
    }
}
