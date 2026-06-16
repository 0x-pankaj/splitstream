/**
 * Hand-maintained minimal ABIs for the on-chain reads/writes the engine makes.
 * Kept in sync with the Solidity in /contracts.
 */

export const vaultAbi = [
  {
    type: "function",
    name: "tenantBalances",
    stateMutability: "view",
    inputs: [{ name: "tenant", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "networkFeePool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "yieldPrincipal",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "executedIntents",
    stateMutability: "view",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "executeIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "tenant", type: "address" },
      { name: "recipientKey", type: "bytes32" },
      { name: "destinationSolver", type: "address" },
      { name: "grossAmount", type: "uint256" },
      { name: "networkFee", type: "uint256" },
      { name: "convenienceFee", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sweepToYield",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "unwindYield",
    stateMutability: "nonpayable",
    inputs: [{ name: "usycAmount", type: "uint256" }],
    outputs: [],
  },
] as const;

export const complianceGuardAbi = [
  {
    type: "function",
    name: "precheck",
    stateMutability: "view",
    inputs: [
      { name: "tenant", type: "address" },
      { name: "recipientKey", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
  {
    type: "function",
    name: "currentWindowVolume",
    stateMutability: "view",
    inputs: [{ name: "tenant", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "dailyVolumeLimit",
    stateMutability: "view",
    inputs: [{ name: "tenant", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "whitelistedRecipients",
    stateMutability: "view",
    inputs: [
      { name: "tenant", type: "address" },
      { name: "recipientKey", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setDailyVolumeLimit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tenant", type: "address" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setRecipientWhitelisted",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tenant", type: "address" },
      { name: "recipientKey", type: "bytes32" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  { type: "error", name: "VelocityLimitExceeded", inputs: [] },
  {
    type: "error",
    name: "RecipientNotWhitelisted",
    inputs: [{ name: "recipientKey", type: "bytes32" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;
