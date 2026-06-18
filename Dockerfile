# SplitStream API — Railway deployment image.
#
# The server runs on Bun (it uses `bun:sqlite` for durable snapshots and runs
# TypeScript directly), but the repo is a pnpm workspace. We install with pnpm
# (so `workspace:*` links resolve with intact symlinks) in the SAME stage we run
# from, then launch with Bun. Single stage avoids breaking pnpm's symlinked
# node_modules across a multi-stage copy.

FROM node:22-slim

# System deps for the Bun installer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Bun (the runtime) and put it on PATH.
ENV BUN_INSTALL="/usr/local"
RUN curl -fsSL https://bun.sh/install | bash

# Install pnpm (the workspace installer) via corepack.
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# Copy workspace manifests first for better layer caching on dependency installs.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

# Install the whole workspace (frozen to the committed lockfile).
RUN pnpm install --frozen-lockfile

# Copy the rest of the source.
COPY . .

# Writable dir for the sqlite snapshot (DATABASE_PATH defaults under here).
RUN mkdir -p /app/apps/server/data

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

WORKDIR /app/apps/server
CMD ["bun", "run", "src/index.ts"]
