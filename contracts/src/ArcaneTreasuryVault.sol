// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IComplianceGuard} from "./interfaces/IComplianceGuard.sol";
import {IUSYCTeller} from "./interfaces/IUSYCTeller.sol";

/**
 * @title ArcaneTreasuryVault
 * @notice Multi-tenant corporate treasury vault for the Arcane Treasury payout
 *         engine, deployed natively on Circle's Arc L1.
 *
 * Because Arc settles all gas in USDC, an enterprise funds this vault once in
 * USDC and the platform streams cross-chain payouts on its behalf with zero
 * volatile gas assets. Every value here is in the 6-decimal USDC ERC-20 view
 * (the 18-decimal native gas representation is never touched in Solidity).
 *
 * Settlement model — the "instant path":
 *   1. An institutional solver fronts a payout to the recipient on the
 *      destination chain (Base, Arbitrum, Ethereum, Solana) from its hot wallet.
 *   2. The platform's trusted relayer calls {executeIntent}, which atomically
 *      enforces compliance, debits the tenant, reimburses the solver in USDC on
 *      Arc, pays the protocol fee, and locks the network fee to fund relaying.
 *
 * The "whale path" (large transfers via native CCTP V2) is orchestrated
 * off-chain and does not flow through {executeIntent}; the vault simply releases
 * the tenant's USDC to the CCTP TokenMessenger via the backend's relayer.
 */
contract ArcaneTreasuryVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The USDC ERC-20 interface (6dp). On Arc this is 0x3600..0000.
    IERC20 public immutable usdc;

    /// @notice Programmable compliance circuit breaker.
    IComplianceGuard public complianceGuard;

    /// @notice Trusted relayer key that submits settlement intents.
    address public relayer;

    /// @notice Protocol fee wallet that receives the convenience fee.
    address public platformFeeWallet;

    /// @notice Circle USYC Teller used to capture idle-balance yield (mock in demo).
    IUSYCTeller public usycTeller;

    /// @notice Segregated per-tenant balances (6dp USDC).
    mapping(address tenant => uint256 balance) public tenantBalances;

    /// @notice Registry of institutional market-makers eligible for reimbursement.
    mapping(address solver => bool whitelisted) public whitelistedSolvers;

    /// @notice Executed intents, for idempotent settlement.
    mapping(bytes32 intentId => bool executed) public executedIntents;

    /// @notice USDC locked to fund autonomous relayer/gas operations (6dp).
    uint256 public networkFeePool;

    /// @notice USDC principal currently deployed into USYC yield (6dp).
    uint256 public yieldPrincipal;

    error NotRelayer();
    error ZeroAmount();
    error IntentAlreadyExecuted(bytes32 intentId);
    error SolverNotWhitelisted(address solver);
    error InsufficientTenantBalance(address tenant, uint256 needed, uint256 available);
    error YieldTellerNotSet();
    error InsufficientIdleBalance(uint256 requested, uint256 idle);

    event Deposited(address indexed tenant, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed tenant, address indexed to, uint256 amount);
    event IntentExecuted(
        bytes32 indexed intentId,
        address indexed tenant,
        address indexed destinationSolver,
        uint256 grossAmount,
        uint256 networkFee,
        uint256 convenienceFee
    );
    event SolverWhitelisted(address indexed solver, bool whitelisted);
    event RelayerUpdated(address indexed relayer);
    event PlatformFeeWalletUpdated(address indexed wallet);
    event ComplianceGuardUpdated(address indexed guard);
    event UsycTellerUpdated(address indexed teller);
    event SweptToYield(uint256 usdcIn, uint256 usycMinted);
    event UnwoundYield(uint256 usycIn, uint256 usdcReturned);
    event NetworkFeePoolWithdrawn(address indexed to, uint256 amount);

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(
        address initialOwner,
        IERC20 _usdc,
        IComplianceGuard _complianceGuard,
        address _relayer,
        address _platformFeeWallet
    ) Ownable(initialOwner) {
        usdc = _usdc;
        complianceGuard = _complianceGuard;
        relayer = _relayer;
        platformFeeWallet = _platformFeeWallet;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
        emit RelayerUpdated(_relayer);
    }

    function setPlatformFeeWallet(address _wallet) external onlyOwner {
        platformFeeWallet = _wallet;
        emit PlatformFeeWalletUpdated(_wallet);
    }

    function setComplianceGuard(IComplianceGuard _guard) external onlyOwner {
        complianceGuard = _guard;
        emit ComplianceGuardUpdated(address(_guard));
    }

    function setUsycTeller(IUSYCTeller _teller) external onlyOwner {
        usycTeller = _teller;
        emit UsycTellerUpdated(address(_teller));
    }

    function setSolverWhitelisted(address solver, bool whitelisted) external onlyOwner {
        whitelistedSolvers[solver] = whitelisted;
        emit SolverWhitelisted(solver, whitelisted);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tenant funding
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Pull USDC from the tenant into the vault and credit its balance.
    /// @dev Tenant must `approve` this vault on the USDC ERC-20 interface first.
    function depositUSDC(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        tenantBalances[msg.sender] += amount;
        emit Deposited(msg.sender, amount, tenantBalances[msg.sender]);
    }

    /// @notice Tenant withdraws unspent balance back to a destination on Arc.
    function withdraw(uint256 amount, address to) external nonReentrant {
        uint256 bal = tenantBalances[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > bal) revert InsufficientTenantBalance(msg.sender, amount, bal);
        tenantBalances[msg.sender] = bal - amount;
        usdc.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Settlement (instant path)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Settle a single payout intent: enforce compliance, debit the
     *         tenant for (gross + network + convenience), reimburse the solver in
     *         USDC, pay the protocol fee, and lock the network fee.
     * @param intentId       Deterministic id (idempotency key).
     * @param tenant         Corporate tenant being debited.
     * @param recipientKey   keccak256 of the destination recipient string (for
     *                       on-chain allowlist enforcement, chain-agnostic).
     * @param destinationSolver Whitelisted market-maker to reimburse.
     * @param grossAmount    Amount the recipient received (6dp).
     * @param networkFee     Relayer/gas funding fee, locked in the pool (6dp).
     * @param convenienceFee Protocol fee paid to the platform wallet (6dp).
     */
    function executeIntent(
        bytes32 intentId,
        address tenant,
        bytes32 recipientKey,
        address destinationSolver,
        uint256 grossAmount,
        uint256 networkFee,
        uint256 convenienceFee
    ) external onlyRelayer nonReentrant {
        if (executedIntents[intentId]) revert IntentAlreadyExecuted(intentId);
        if (!whitelistedSolvers[destinationSolver]) {
            revert SolverNotWhitelisted(destinationSolver);
        }
        if (grossAmount == 0) revert ZeroAmount();

        uint256 total = grossAmount + networkFee + convenienceFee;
        uint256 bal = tenantBalances[tenant];
        if (total > bal) revert InsufficientTenantBalance(tenant, total, bal);

        // Atomically enforce recipient allowlist + rolling velocity, recording
        // the gross volume. Reverts on any breach.
        complianceGuard.enforce(tenant, recipientKey, grossAmount);

        // Effects.
        executedIntents[intentId] = true;
        tenantBalances[tenant] = bal - total;
        networkFeePool += networkFee;

        // Interactions: reimburse the solver and pay the protocol fee.
        usdc.safeTransfer(destinationSolver, grossAmount);
        if (convenienceFee > 0) {
            usdc.safeTransfer(platformFeeWallet, convenienceFee);
        }

        emit IntentExecuted(
            intentId, tenant, destinationSolver, grossAmount, networkFee, convenienceFee
        );
    }

    /// @notice Owner withdraws accumulated network fees (e.g. to top up relayer gas).
    function withdrawNetworkFees(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > networkFeePool) {
            revert InsufficientIdleBalance(amount, networkFeePool);
        }
        networkFeePool -= amount;
        usdc.safeTransfer(to, amount);
        emit NetworkFeePoolWithdrawn(to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Idle-balance yield (Circle USYC)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice USDC sitting idle in the vault, excluding tenant principal pools.
    /// @dev Idle = vault USDC balance minus (sum tracked elsewhere). We track the
    ///      conservative figure: balance less the network fee pool, which the
    ///      owner controls separately. Tenant balances also live in `balance`, so
    ///      the owner must only sweep genuinely idle treasury float.
    function idleBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice Deposit idle vault USDC into Circle USYC to capture low-risk yield.
    function sweepToYield(uint256 amount) external onlyOwner nonReentrant {
        if (address(usycTeller) == address(0)) revert YieldTellerNotSet();
        if (amount == 0) revert ZeroAmount();
        uint256 idle = idleBalance();
        if (amount > idle) revert InsufficientIdleBalance(amount, idle);

        usdc.forceApprove(address(usycTeller), amount);
        uint256 minted = usycTeller.deposit(amount);
        yieldPrincipal += amount;
        emit SweptToYield(amount, minted);
    }

    /// @notice Redeem USYC shares back into liquid USDC to satisfy payout queues.
    function unwindYield(uint256 usycAmount) external onlyOwner nonReentrant {
        if (address(usycTeller) == address(0)) revert YieldTellerNotSet();
        if (usycAmount == 0) revert ZeroAmount();

        IERC20 usyc = IERC20(usycTeller.usyc());
        usyc.forceApprove(address(usycTeller), usycAmount);
        uint256 returned = usycTeller.redeem(usycAmount);
        // Reduce tracked principal, flooring at zero (yield above principal stays).
        yieldPrincipal = returned >= yieldPrincipal ? 0 : yieldPrincipal - returned;
        emit UnwoundYield(usycAmount, returned);
    }
}
