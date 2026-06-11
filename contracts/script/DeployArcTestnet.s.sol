// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArcaneTreasuryVault} from "../src/ArcaneTreasuryVault.sol";
import {ArcaneComplianceGuard} from "../src/ArcaneComplianceGuard.sol";
import {IComplianceGuard} from "../src/interfaces/IComplianceGuard.sol";
import {IUSYCTeller} from "../src/interfaces/IUSYCTeller.sol";
import {MockUSYCTeller} from "../src/mocks/MockUSYCTeller.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployArcTestnet
 * @notice Deploys the Arcane Treasury stack to Arc Testnet (chain id 5042002).
 *
 * Uses Arc's REAL native USDC ERC-20 interface (0x3600…0000) for the vault, and
 * deploys a MockUSYCTeller for the yield demo because the real USYC Teller is
 * gated behind Entitlements allowlisting (24-48h). The deployer becomes the
 * owner and (by default) the relayer.
 *
 * Run:
 *   forge script script/DeployArcTestnet.s.sol:DeployArcTestnet \
 *     --rpc-url $ARC_TESTNET_RPC_URL --private-key $RELAYER_PRIVATE_KEY --broadcast
 *
 * Optional env overrides: USDC_ADDRESS, RELAYER_ADDRESS, PLATFORM_FEE_WALLET,
 * DEMO_SOLVER (whitelisted on deploy for the live round-trip demo).
 */
contract DeployArcTestnet is Script {
    address constant ARC_NATIVE_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 pk = vm.envUint("RELAYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address usdc = vm.envOr("USDC_ADDRESS", ARC_NATIVE_USDC);
        address relayer = vm.envOr("RELAYER_ADDRESS", deployer);
        address platformWallet = vm.envOr("PLATFORM_FEE_WALLET", deployer);
        address demoSolver = vm.envOr("DEMO_SOLVER", address(0));

        vm.startBroadcast(pk);

        ArcaneComplianceGuard guard = new ArcaneComplianceGuard(deployer);
        ArcaneTreasuryVault vault =
            new ArcaneTreasuryVault(deployer, IERC20(usdc), guard, relayer, platformWallet);
        MockUSYCTeller teller = new MockUSYCTeller(IERC20(usdc), 500); // +5% demo yield

        // Wire the stack together.
        guard.setAuthorizedCaller(address(vault), true);
        vault.setUsycTeller(IUSYCTeller(address(teller)));
        if (demoSolver != address(0)) {
            vault.setSolverWhitelisted(demoSolver, true);
        }

        vm.stopBroadcast();

        console2.log("== Arcane Treasury deployed to Arc Testnet ==");
        console2.log("Deployer / owner:    ", deployer);
        console2.log("USDC (ERC-20 iface): ", usdc);
        console2.log("ComplianceGuard:     ", address(guard));
        console2.log("TreasuryVault:       ", address(vault));
        console2.log("MockUSYCTeller:      ", address(teller));
        console2.log("Relayer:             ", relayer);
        console2.log("PlatformFeeWallet:   ", platformWallet);
    }
}
