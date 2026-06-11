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
 * @title DeployAndDemo
 * @notice One-shot LIVE proof on Arc Testnet: deploys the full stack against the
 *         real native USDC interface (0x3600…), configures compliance, then
 *         performs a real deposit + executeIntent round-trip and logs every tx
 *         hash for the grant proposal.
 *
 * The broadcasting deployer plays all roles for the demo (owner, relayer,
 * tenant, whitelisted solver, platform fee wallet). Amounts are tiny so a small
 * faucet allocation suffices. Requires the deployer to hold a little USDC
 * (which is also the gas token on Arc).
 *
 * Run after funding the deployer at the Circle Faucet:
 *   source .env && forge script script/DeployAndDemo.s.sol:DeployAndDemo \
 *     --rpc-url $ARC_TESTNET_RPC_URL --private-key $RELAYER_PRIVATE_KEY --broadcast -vvv
 */
contract DeployAndDemo is Script {
    address constant ARC_NATIVE_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 pk = vm.envUint("RELAYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        IERC20 usdc = IERC20(ARC_NATIVE_USDC);

        bytes32 recipientKey = keccak256(bytes("arc-grant-demo-recipient"));

        vm.startBroadcast(pk);

        // 1) Deploy + wire the stack.
        ArcaneComplianceGuard guard = new ArcaneComplianceGuard(me);
        ArcaneTreasuryVault vault =
            new ArcaneTreasuryVault(me, usdc, guard, me, me);
        MockUSYCTeller teller = new MockUSYCTeller(usdc, 0);

        guard.setAuthorizedCaller(address(vault), true);
        guard.setDailyVolumeLimit(me, 1_000_000_000); // $1,000 cap
        guard.setRecipientWhitelisted(me, recipientKey, true);
        vault.setSolverWhitelisted(me, true);
        vault.setUsycTeller(IUSYCTeller(address(teller)));

        // 2) Fund the vault: approve + deposit $0.20 (200000, 6dp).
        usdc.approve(address(vault), 200_000);
        vault.depositUSDC(200_000);

        // 3) Settle a real instant-path intent (gross $0.10, net $0.01, conv $0.005).
        bytes32 intentId = keccak256(abi.encodePacked("arc-grant-demo-intent", block.number));
        vault.executeIntent(intentId, me, recipientKey, me, 100_000, 10_000, 5_000);

        vm.stopBroadcast();

        console2.log("== Arcane Treasury LIVE on Arc Testnet ==");
        console2.log("Deployer/owner/relayer:", me);
        console2.log("ComplianceGuard:       ", address(guard));
        console2.log("TreasuryVault:         ", address(vault));
        console2.log("MockUSYCTeller:        ", address(teller));
        console2.log("Demo intentId:");
        console2.logBytes32(intentId);
        console2.log("Tenant balance after (6dp):", vault.tenantBalances(me));
        console2.log("Network fee pool (6dp):    ", vault.networkFeePool());
    }
}
