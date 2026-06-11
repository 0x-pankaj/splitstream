// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IComplianceGuard} from "./interfaces/IComplianceGuard.sol";

/**
 * @title ArcaneComplianceGuard
 * @notice Defensive, programmable risk-management circuit breaker for the
 *         Arcane Treasury payout engine.
 *
 *  - Enforces a rolling 24h transaction-volume cap per corporate tenant.
 *  - Enforces a per-tenant recipient allowlist, blocking non-vetted or
 *    sanctioned destinations at the smart-contract level.
 *
 * Velocity model: a 24h window that resets when the first transaction after the
 * window's expiry arrives. This bounds volume to `dailyVolumeLimit` per rolling
 * 24h period without the gas cost of a per-transaction ring buffer. It is
 * enforced ATOMICALLY inside the vault's `executeIntent` (via `enforce`) and is
 * also exposed as a read-only `precheck` the backend calls with eth_call before
 * committing a batch.
 *
 * Recipients are keyed by `bytes32 recipientKey = keccak256(recipientString)`,
 * making the allowlist chain-agnostic across EVM and Solana destinations.
 */
contract ArcaneComplianceGuard is Ownable2Step, IComplianceGuard {
    /// @notice Length of the rolling velocity window.
    uint256 public constant WINDOW = 24 hours;

    /// @notice Per-tenant rolling 24h volume cap (6dp USDC). Zero = unconfigured (blocks all).
    mapping(address tenant => uint256 limit) public dailyVolumeLimit;

    /// @notice Start timestamp of each tenant's current velocity window.
    mapping(address tenant => uint256 start) public windowStart;

    /// @notice Accumulated volume within the current window (6dp USDC).
    mapping(address tenant => uint256 volume) public windowVolume;

    /// @notice Per-tenant recipient allowlist, keyed by keccak256(recipient string).
    mapping(address tenant => mapping(bytes32 recipientKey => bool allowed))
        public whitelistedRecipients;

    /// @notice Addresses permitted to call `enforce` (the treasury vault).
    mapping(address caller => bool authorized) public authorizedCallers;

    error NotAuthorized();
    error TenantLimitNotConfigured(address tenant);

    event DailyVolumeLimitSet(address indexed tenant, uint256 limit);
    event RecipientWhitelisted(address indexed tenant, bytes32 indexed recipientKey, bool allowed);
    event CallerAuthorized(address indexed caller, bool authorized);
    event VolumeRecorded(address indexed tenant, uint256 amount, uint256 windowVolume);

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Admin (platform-operated compliance configuration)
    // ─────────────────────────────────────────────────────────────────────────

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    function setDailyVolumeLimit(address tenant, uint256 limit) external onlyOwner {
        dailyVolumeLimit[tenant] = limit;
        emit DailyVolumeLimitSet(tenant, limit);
    }

    function setRecipientWhitelisted(address tenant, bytes32 recipientKey, bool allowed)
        external
        onlyOwner
    {
        whitelistedRecipients[tenant][recipientKey] = allowed;
        emit RecipientWhitelisted(tenant, recipientKey, allowed);
    }

    /// @notice Batch-configure a tenant's recipient allowlist in one transaction.
    function setRecipientsWhitelisted(
        address tenant,
        bytes32[] calldata recipientKeys,
        bool allowed
    ) external onlyOwner {
        for (uint256 i = 0; i < recipientKeys.length; i++) {
            whitelistedRecipients[tenant][recipientKeys[i]] = allowed;
            emit RecipientWhitelisted(tenant, recipientKeys[i], allowed);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Enforcement
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IComplianceGuard
    function enforce(address tenant, bytes32 recipientKey, uint256 amount) external {
        if (!authorizedCallers[msg.sender]) revert NotAuthorized();
        _checkRecipient(tenant, recipientKey);

        uint256 effective = _effectiveVolume(tenant);
        uint256 limit = dailyVolumeLimit[tenant];
        if (limit == 0) revert TenantLimitNotConfigured(tenant);
        if (effective + amount > limit) revert VelocityLimitExceeded();

        // Commit the (possibly reset) window and the new volume.
        if (block.timestamp >= windowStart[tenant] + WINDOW) {
            windowStart[tenant] = block.timestamp;
            windowVolume[tenant] = amount;
        } else {
            windowVolume[tenant] = effective + amount;
        }
        emit VolumeRecorded(tenant, amount, windowVolume[tenant]);
    }

    /// @inheritdoc IComplianceGuard
    function precheck(address tenant, bytes32 recipientKey, uint256 amount)
        external
        view
        returns (bool ok)
    {
        _checkRecipient(tenant, recipientKey);
        uint256 limit = dailyVolumeLimit[tenant];
        if (limit == 0) revert TenantLimitNotConfigured(tenant);
        if (_effectiveVolume(tenant) + amount > limit) revert VelocityLimitExceeded();
        return true;
    }

    /// @notice Current window volume, treating an expired window as zero.
    function currentWindowVolume(address tenant) external view returns (uint256) {
        return _effectiveVolume(tenant);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _checkRecipient(address tenant, bytes32 recipientKey) internal view {
        if (!whitelistedRecipients[tenant][recipientKey]) {
            revert RecipientNotWhitelisted(recipientKey);
        }
    }

    function _effectiveVolume(address tenant) internal view returns (uint256) {
        if (block.timestamp >= windowStart[tenant] + WINDOW) {
            return 0;
        }
        return windowVolume[tenant];
    }
}
