// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArcaneComplianceGuard} from "../src/ArcaneComplianceGuard.sol";
import {IComplianceGuard} from "../src/interfaces/IComplianceGuard.sol";

contract ArcaneComplianceGuardTest is Test {
    ArcaneComplianceGuard internal guard;

    address internal owner = makeAddr("owner");
    address internal vault = makeAddr("vault"); // authorized caller
    address internal tenant = makeAddr("tenant");
    address internal stranger = makeAddr("stranger");

    bytes32 internal recipientKey = keccak256(bytes("0x1111111111111111111111111111111111111111"));
    bytes32 internal badRecipient = keccak256(bytes("0x9999999999999999999999999999999999999999"));

    uint256 internal constant LIMIT = 10_000_000_000; // $10,000 (6dp)

    function setUp() public {
        vm.prank(owner);
        guard = new ArcaneComplianceGuard(owner);

        vm.startPrank(owner);
        guard.setAuthorizedCaller(vault, true);
        guard.setDailyVolumeLimit(tenant, LIMIT);
        guard.setRecipientWhitelisted(tenant, recipientKey, true);
        vm.stopPrank();
    }

    function test_enforce_happyPath_recordsVolume() public {
        vm.prank(vault);
        guard.enforce(tenant, recipientKey, 1_000_000_000); // $1,000
        assertEq(guard.currentWindowVolume(tenant), 1_000_000_000);
    }

    function test_enforce_onlyAuthorizedCaller() public {
        vm.prank(stranger);
        vm.expectRevert(ArcaneComplianceGuard.NotAuthorized.selector);
        guard.enforce(tenant, recipientKey, 1);
    }

    function test_enforce_revertsForNonWhitelistedRecipient() public {
        vm.prank(vault);
        vm.expectRevert(
            abi.encodeWithSelector(IComplianceGuard.RecipientNotWhitelisted.selector, badRecipient)
        );
        guard.enforce(tenant, badRecipient, 1_000_000);
    }

    function test_enforce_revertsWhenLimitNotConfigured() public {
        address freshTenant = makeAddr("freshTenant");
        vm.prank(owner);
        guard.setRecipientWhitelisted(freshTenant, recipientKey, true);
        vm.prank(vault);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcaneComplianceGuard.TenantLimitNotConfigured.selector, freshTenant
            )
        );
        guard.enforce(freshTenant, recipientKey, 1);
    }

    function test_enforce_revertsWhenVelocityExceeded() public {
        vm.prank(vault);
        guard.enforce(tenant, recipientKey, 9_000_000_000); // $9,000 ok

        vm.prank(vault);
        vm.expectRevert(IComplianceGuard.VelocityLimitExceeded.selector);
        guard.enforce(tenant, recipientKey, 2_000_000_000); // +$2,000 -> $11,000 > $10,000
    }

    function test_enforce_atExactLimitSucceeds() public {
        vm.prank(vault);
        guard.enforce(tenant, recipientKey, LIMIT); // exactly $10,000
        assertEq(guard.currentWindowVolume(tenant), LIMIT);
    }

    function test_velocityWindowResetsAfter24h() public {
        vm.prank(vault);
        guard.enforce(tenant, recipientKey, LIMIT); // fill the window

        // Same window: further volume must revert.
        vm.prank(vault);
        vm.expectRevert(IComplianceGuard.VelocityLimitExceeded.selector);
        guard.enforce(tenant, recipientKey, 1);

        // Advance past the window; volume resets and a fresh batch clears.
        vm.warp(block.timestamp + 24 hours + 1);
        assertEq(guard.currentWindowVolume(tenant), 0);
        vm.prank(vault);
        guard.enforce(tenant, recipientKey, LIMIT);
        assertEq(guard.currentWindowVolume(tenant), LIMIT);
    }

    function test_precheck_isViewAndDoesNotRecord() public {
        vm.prank(vault);
        bool ok = guard.precheck(tenant, recipientKey, 5_000_000_000);
        assertTrue(ok);
        assertEq(guard.currentWindowVolume(tenant), 0); // unchanged
    }

    function test_precheck_revertsLikeEnforce() public {
        vm.expectRevert(
            abi.encodeWithSelector(IComplianceGuard.RecipientNotWhitelisted.selector, badRecipient)
        );
        guard.precheck(tenant, badRecipient, 1);
    }

    function test_onlyOwnerCanConfigure() public {
        vm.prank(stranger);
        vm.expectRevert();
        guard.setDailyVolumeLimit(tenant, 1);

        vm.prank(stranger);
        vm.expectRevert();
        guard.setRecipientWhitelisted(tenant, recipientKey, false);
    }

    function test_batchWhitelist() public {
        bytes32[] memory keys = new bytes32[](2);
        keys[0] = keccak256(bytes("a"));
        keys[1] = keccak256(bytes("b"));
        vm.prank(owner);
        guard.setRecipientsWhitelisted(tenant, keys, true);
        assertTrue(guard.whitelistedRecipients(tenant, keys[0]));
        assertTrue(guard.whitelistedRecipients(tenant, keys[1]));
    }
}
