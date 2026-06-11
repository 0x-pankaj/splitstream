SHELL := /bin/bash
FOUNDRY := $(HOME)/.foundry/bin

.PHONY: install build test contracts-test deploy deploy-demo server web mcp seed \
	prove-cctp gateway-deposit gateway-balance prove-gateway

install:
	pnpm install

build:
	pnpm build

test:
	pnpm test
	cd contracts && $(FOUNDRY)/forge test

contracts-test:
	cd contracts && $(FOUNDRY)/forge test -vvv

server:
	pnpm --filter @arcane/server dev

web:
	pnpm --filter @arcane/web dev

mcp:
	bun run apps/server/src/mcp/stdio.ts

seed:
	pnpm --filter @arcane/server seed

# Deploy the stack to Arc Testnet (no round-trip). Requires a funded deployer.
deploy:
	cd contracts && source .env && $(FOUNDRY)/forge script \
	  script/DeployArcTestnet.s.sol:DeployArcTestnet \
	  --rpc-url $$ARC_TESTNET_RPC_URL --private-key $$RELAYER_PRIVATE_KEY --broadcast -vvv

# Deploy + a real on-chain deposit + executeIntent round-trip (captures tx hashes).
# Uses forge create + cast send: Arc's native USDC calls an on-chain blocklist
# precompile that forge script's LOCAL EVM cannot simulate.
deploy-demo:
	bash scripts/deploy-live.sh

# ── Live rail proofs (require a funded RELAYER_PRIVATE_KEY; no kit key) ────────
# Whale rail: real CCTP burn on Arc → mint on Base Sepolia (forwarder).
prove-cctp:
	source apps/server/.env 2>/dev/null; bun run apps/server/scripts/bridge-arc-to-base.ts $(AMOUNT) $(TO)

# Instant rail: one-time deposit of the Gateway float on Arc…
gateway-deposit:
	source apps/server/.env 2>/dev/null; bun run apps/server/scripts/gateway-deposit.ts $(AMOUNT)

# …then a real sub-500ms Gateway spend Arc → Base Sepolia (forwarder).
prove-gateway:
	source apps/server/.env 2>/dev/null; bun run apps/server/scripts/gateway-spend-arc-to-base.ts $(AMOUNT) $(TO)

# Inspect the unified balance across testnet chains.
gateway-balance:
	source apps/server/.env 2>/dev/null; bun run apps/server/scripts/gateway-balance.ts
