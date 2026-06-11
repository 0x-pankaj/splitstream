#!/usr/bin/env bash
# Live deploy + on-chain round-trip on Arc Testnet.
#
# Why not `forge script`? Arc's native USDC (0x3600) calls the on-chain blocklist
# precompile (0x1800..0001) on every transfer, which Foundry's LOCAL EVM cannot
# execute. So we deploy the contracts with `forge create` (constructors never
# touch the precompile) and send the USDC-touching txs with `cast send`, which
# estimates/executes against the real Arc node where the precompile exists.
set -euo pipefail

export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/../contracts"
set -a; source .env; set +a

RPC="$ARC_TESTNET_RPC_URL"
PK="$RELAYER_PRIVATE_KEY"
ME="$(cast wallet address --private-key "$PK")"
USDC="0x3600000000000000000000000000000000000000"

echo "Deployer: $ME"

create() { # contract  [constructor args...]
  forge create "$1" --rpc-url "$RPC" --private-key "$PK" --broadcast --json \
    "${@:2}" | python3 -c "import sys,json;print(json.load(sys.stdin)['deployedTo'])"
}

echo "→ deploying ArcaneComplianceGuard…"
GUARD=$(create src/ArcaneComplianceGuard.sol:ArcaneComplianceGuard --constructor-args "$ME")
echo "  ComplianceGuard: $GUARD"

echo "→ deploying ArcaneTreasuryVault…"
VAULT=$(create src/ArcaneTreasuryVault.sol:ArcaneTreasuryVault \
  --constructor-args "$ME" "$USDC" "$GUARD" "$ME" "$ME")
echo "  TreasuryVault:   $VAULT"

echo "→ deploying MockUSYCTeller…"
TELLER=$(create src/mocks/MockUSYCTeller.sol:MockUSYCTeller --constructor-args "$USDC" 0)
echo "  MockUSYCTeller:  $TELLER"

RKEY=$(cast keccak "arc-grant-demo-recipient")
INTENT=$(cast keccak "arc-grant-demo-intent-1")

send() { cast send --rpc-url "$RPC" --private-key "$PK" --json "$@" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['transactionHash'],'status='+d['status'])"; }

echo "→ wiring compliance + vault…"
send "$GUARD" "setAuthorizedCaller(address,bool)" "$VAULT" true            >/dev/null
send "$GUARD" "setDailyVolumeLimit(address,uint256)" "$ME" 1000000000      >/dev/null
send "$GUARD" "setRecipientWhitelisted(address,bytes32,bool)" "$ME" "$RKEY" true >/dev/null
send "$VAULT" "setSolverWhitelisted(address,bool)" "$ME" true             >/dev/null
send "$VAULT" "setUsycTeller(address)" "$TELLER"                          >/dev/null

echo "→ approve + depositUSDC (0.2 USDC)…"
APPROVE_TX=$(send "$USDC" "approve(address,uint256)" "$VAULT" 200000)
echo "  approve:  $APPROVE_TX"
DEPOSIT_TX=$(send "$VAULT" "depositUSDC(uint256)" 200000)
echo "  deposit:  $DEPOSIT_TX"

echo "→ executeIntent (gross 0.10, net 0.01, conv 0.005 USDC)…"
EXEC_TX=$(send "$VAULT" "executeIntent(bytes32,address,bytes32,address,uint256,uint256,uint256)" \
  "$INTENT" "$ME" "$RKEY" "$ME" 100000 10000 5000)
echo "  execute:  $EXEC_TX"

echo ""
echo "Tenant balance after (6dp): $(cast call "$VAULT" 'tenantBalances(address)(uint256)' "$ME" --rpc-url "$RPC")"
echo "Network fee pool   (6dp):   $(cast call "$VAULT" 'networkFeePool()(uint256)' --rpc-url "$RPC")"
echo "Intent executed?:           $(cast call "$VAULT" 'executedIntents(bytes32)(bool)' "$INTENT" --rpc-url "$RPC")"

echo ""
echo "=== DEPLOYMENT SUMMARY ==="
echo "ComplianceGuard=$GUARD"
echo "TreasuryVault=$VAULT"
echo "MockUSYCTeller=$TELLER"
echo "recipientKey=$RKEY"
echo "intentId=$INTENT"
