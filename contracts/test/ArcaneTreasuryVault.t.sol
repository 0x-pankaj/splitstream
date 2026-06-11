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

contract ArcaneTreasuryVaultTest is Test {
    ArcaneTreasuryVault internal vault;
    ArcaneComplianceGuard internal guard;
    MockUSDC internal usdc;
    MockUSYCTeller internal teller;

    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal platformWallet = makeAddr("platformWallet");
    address internal solver = makeAddr("solver");
    address internal tenantA = makeAddr("tenantA");
    address internal tenantB = makeAddr("tenantB");

    bytes32 internal recipientKey = keccak256(bytes("recipient-on-base"));

    uint256 internal constant LIMIT = 1_000_000_000_000; // $1,000,000 (6dp)

    function setUp() public {
        usdc = new MockUSDC();

        vm.prank(owner);
        guard = new ArcaneComplianceGuard(owner);

        vm.prank(owner);
        vault = new ArcaneTreasuryVault(owner, IERC20(address(usdc)), guard, relayer, platformWallet);

        teller = new MockUSYCTeller(IERC20(address(usdc)), 500); // +5% yield on redeem
        usdc.mint(address(teller), 10_000_000_000); // $10k yield reserve buffer

        vm.startPrank(owner);
        guard.setAuthorizedCaller(address(vault), true);
        guard.setDailyVolumeLimit(tenantA, LIMIT);
        guard.setDailyVolumeLimit(tenantB, LIMIT);
        guard.setRecipientWhitelisted(tenantA, recipientKey, true);
        guard.setRecipientWhitelisted(tenantB, recipientKey, true);
        vault.setSolverWhitelisted(solver, true);
        vault.setUsycTeller(IUSYCTeller(address(teller)));
        vm.stopPrank();

        // Fund tenants and approve the vault.
        _fundAndDeposit(tenantA, 100_000_000_000); // $100,000
        _fundAndDeposit(tenantB, 50_000_000_000); //  $50,000
    }

    function _fundAndDeposit(address tenant, uint256 amount) internal {
        usdc.mint(tenant, amount);
        vm.startPrank(tenant);
        usdc.approve(address(vault), amount);
        vault.depositUSDC(amount);
        vm.stopPrank();
    }

    // ── Deposits & multi-tenant isolation ──────────────────────────────────

    function test_deposit_creditsTenantAndPullsUsdc() public {
        assertEq(vault.tenantBalances(tenantA), 100_000_000_000);
        assertEq(vault.tenantBalances(tenantB), 50_000_000_000);
        assertEq(usdc.balanceOf(address(vault)), 150_000_000_000);
    }

    function test_deposit_zeroReverts() public {
        vm.prank(tenantA);
        vm.expectRevert(ArcaneTreasuryVault.ZeroAmount.selector);
        vault.depositUSDC(0);
    }

    function test_multiTenantIsolation_executeDoesNotTouchOtherTenant() public {
        uint256 gross = 1_000_000_000; // $1,000
        uint256 net = 10_000;
        uint256 conv = 5_000_000;
        vm.prank(relayer);
        vault.executeIntent(
            keccak256("intent-1"), tenantA, recipientKey, solver, gross, net, conv
        );
        assertEq(vault.tenantBalances(tenantA), 100_000_000_000 - gross - net - conv);
        assertEq(vault.tenantBalances(tenantB), 50_000_000_000); // untouched
    }

    // ── executeIntent happy path ────────────────────────────────────────────

    function test_executeIntent_distributesFundsAndFees() public {
        uint256 gross = 2_000_000_000; // $2,000
        uint256 net = 10_000; // $0.01
        uint256 conv = 10_000_000; // $10

        vm.prank(relayer);
        vault.executeIntent(keccak256("i"), tenantA, recipientKey, solver, gross, net, conv);

        assertEq(usdc.balanceOf(solver), gross, "solver reimbursed");
        assertEq(usdc.balanceOf(platformWallet), conv, "platform fee paid");
        assertEq(vault.networkFeePool(), net, "network fee locked");
        assertEq(vault.tenantBalances(tenantA), 100_000_000_000 - gross - net - conv);
        assertTrue(vault.executedIntents(keccak256("i")));
    }

    function test_executeIntent_zeroConvenienceFeeSkipsTransfer() public {
        vm.prank(relayer);
        vault.executeIntent(keccak256("i"), tenantA, recipientKey, solver, 1_000_000, 0, 0);
        assertEq(usdc.balanceOf(platformWallet), 0);
    }

    // ── executeIntent guards ─────────────────────────────────────────────────

    function test_executeIntent_onlyRelayer() public {
        vm.prank(owner);
        vm.expectRevert(ArcaneTreasuryVault.NotRelayer.selector);
        vault.executeIntent(keccak256("i"), tenantA, recipientKey, solver, 1, 0, 0);
    }

    function test_executeIntent_rejectsDuplicateIntent() public {
        bytes32 id = keccak256("dup");
        vm.prank(relayer);
        vault.executeIntent(id, tenantA, recipientKey, solver, 1_000_000, 0, 0);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcaneTreasuryVault.IntentAlreadyExecuted.selector, id));
        vault.executeIntent(id, tenantA, recipientKey, solver, 1_000_000, 0, 0);
    }

    function test_executeIntent_rejectsNonWhitelistedSolver() public {
        address rogue = makeAddr("rogue");
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(ArcaneTreasuryVault.SolverNotWhitelisted.selector, rogue));
        vault.executeIntent(keccak256("i"), tenantA, recipientKey, rogue, 1_000_000, 0, 0);
    }

    function test_executeIntent_rejectsInsufficientBalance() public {
        uint256 tooMuch = 200_000_000_000; // $200k > tenantA's $100k
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(
                ArcaneTreasuryVault.InsufficientTenantBalance.selector,
                tenantA,
                tooMuch,
                100_000_000_000
            )
        );
        vault.executeIntent(keccak256("i"), tenantA, recipientKey, solver, tooMuch, 0, 0);
    }

    function test_executeIntent_propagatesComplianceVelocityRevert() public {
        // tenantB limit is $1,000,000; push a gross above it.
        uint256 gross = 1_000_000_000_001;
        usdc.mint(tenantB, gross);
        vm.startPrank(tenantB);
        usdc.approve(address(vault), gross);
        vault.depositUSDC(gross);
        vm.stopPrank();

        vm.prank(relayer);
        vm.expectRevert(IComplianceGuard.VelocityLimitExceeded.selector);
        vault.executeIntent(keccak256("i"), tenantB, recipientKey, solver, gross, 0, 0);
    }

    function test_executeIntent_propagatesRecipientRevert() public {
        bytes32 notAllowed = keccak256(bytes("sanctioned"));
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(IComplianceGuard.RecipientNotWhitelisted.selector, notAllowed)
        );
        vault.executeIntent(keccak256("i"), tenantA, notAllowed, solver, 1_000_000, 0, 0);
    }

    // ── Withdrawals ──────────────────────────────────────────────────────────

    function test_withdraw_returnsFunds() public {
        vm.prank(tenantA);
        vault.withdraw(10_000_000_000, tenantA);
        assertEq(vault.tenantBalances(tenantA), 90_000_000_000);
        assertEq(usdc.balanceOf(tenantA), 10_000_000_000);
    }

    function test_withdrawNetworkFees_onlyOwner() public {
        vm.prank(relayer);
        vault.executeIntent(keccak256("i"), tenantA, recipientKey, solver, 1_000_000, 50_000, 0);
        assertEq(vault.networkFeePool(), 50_000);

        vm.prank(owner);
        vault.withdrawNetworkFees(relayer, 50_000);
        assertEq(vault.networkFeePool(), 0);
        assertEq(usdc.balanceOf(relayer), 50_000);
    }

    // ── USYC yield lifecycle ─────────────────────────────────────────────────

    function test_sweepAndUnwindYield_accruesYield() public {
        uint256 sweep = 40_000_000_000; // $40,000 idle into USYC
        vm.prank(owner);
        vault.sweepToYield(sweep);
        assertEq(vault.yieldPrincipal(), sweep);
        assertEq(IERC20(teller.usyc()).balanceOf(address(vault)), sweep);

        uint256 before = usdc.balanceOf(address(vault));
        vm.prank(owner);
        vault.unwindYield(sweep);
        uint256 returned = usdc.balanceOf(address(vault)) - before;
        assertEq(returned, sweep + (sweep * 500) / 10_000, "principal + 5% yield");
        assertEq(vault.yieldPrincipal(), 0);
    }

    function test_sweep_revertsWhenTellerUnset() public {
        vm.prank(owner);
        vault.setUsycTeller(IUSYCTeller(address(0)));
        vm.prank(owner);
        vm.expectRevert(ArcaneTreasuryVault.YieldTellerNotSet.selector);
        vault.sweepToYield(1_000_000);
    }

    function test_sweep_onlyOwner() public {
        vm.prank(relayer);
        vm.expectRevert();
        vault.sweepToYield(1_000_000);
    }
}
