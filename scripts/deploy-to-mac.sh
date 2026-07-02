#!/usr/bin/env bash
# Push local code to the always-on deploy Mac and rebuild/restart the stack.
#
# Flow: push the current (or given) branch to origin → over Tailscale SSH, the
# deploy box fetches + checks it out → docker compose rebuilds the changed
# services (the one-shot `migrate` runs `prisma migrate deploy` first). The
# frontend lives on Vercel, so only backend/worker/trigger are rebuilt here.
#
# Usage:
#   scripts/deploy-to-mac.sh                 # deploy the current branch
#   scripts/deploy-to-mac.sh <branch>        # deploy a specific branch
#   RESTART_ONLY=1 scripts/deploy-to-mac.sh  # just restart (no rebuild)
#
# Config (env overrides):
#   DEPLOY_HOST  Tailscale host/IP of the deploy Mac (default 100.89.51.105)
#   DEPLOY_DIR   repo path on the deploy Mac (default ~/Desktop/projects/web3-zapier)
#   SERVICES     compose services to (re)build (default: migrate backend worker trigger)
set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
DEPLOY_HOST="${DEPLOY_HOST:-100.89.51.105}"
DEPLOY_DIR="${DEPLOY_DIR:-~/Desktop/projects/web3-zapier}"
SERVICES="${SERVICES:-migrate backend worker trigger}"
COMPOSE="docker compose -f docker-compose.prod.yml"

say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

say "Pushing '$BRANCH' to origin"
git push origin "$BRANCH"

BUILD_FLAG="--build"
[ "${RESTART_ONLY:-0}" = "1" ] && BUILD_FLAG=""

say "Updating deploy box ($DEPLOY_HOST) → $BRANCH, rebuilding: $SERVICES"
tailscale ssh "$DEPLOY_HOST" "
  set -e
  cd $DEPLOY_DIR
  git fetch origin
  git checkout $BRANCH
  git pull --ff-only origin $BRANCH
  $COMPOSE up -d $BUILD_FLAG $SERVICES
  echo '--- migrate result ---'
  $COMPOSE logs --tail=5 migrate 2>/dev/null || true
  echo '--- services ---'
  $COMPOSE ps --format '{{.Service}}\t{{.Status}}'
"
say "Done. Backend: https://pulsar-backend.tail592907.ts.net"
