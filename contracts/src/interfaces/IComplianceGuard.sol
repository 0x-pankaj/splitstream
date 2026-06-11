// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IComplianceGuard
 * @notice Programmable risk circuit-breaker enforced atomically during payout
 *         execution and queryable off-chain (eth_call) for pre-flight checks.
 */
interface IComplianceGuard {
    error VelocityLimitExceeded();
    error RecipientNotWhitelisted(bytes32 recipientKey);

    /**
     * @notice Atomically enforce recipient whitelist + rolling velocity for a
     *         tenant, recording the volume on success. Callable only by an
     *         authorized caller (the vault). Reverts on any breach.
     * @param tenant       The corporate tenant initiating the payout.
     * @param recipientKey keccak256 of the destination recipient address string
     *                     (chain-agnostic: works for EVM and Solana recipients).
     * @param amount       Gross payout amount counted toward the velocity window (6dp).
     */
    function enforce(address tenant, bytes32 recipientKey, uint256 amount) external;

    /**
     * @notice Read-only pre-flight check used by the backend via eth_call before
     *         settling a payout. Reverts with the same errors as `enforce` but
     *         mutates no state.
     */
    function precheck(address tenant, bytes32 recipientKey, uint256 amount)
        external
        view
        returns (bool ok);
}
