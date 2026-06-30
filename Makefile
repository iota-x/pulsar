# Local dev for web3-zapier.
#   make dev    → DB layer + all four services in one terminal (Ctrl+C stops all)
#   make db     → just Postgres + Redis (Docker)
#   make down   → stop the Docker DB layer
#
# Each service runs from its own workspace dir, so it auto-loads its local
# apps/<app>/.env (localhost). The root .env is only for the Docker prod stack.
#
# We invoke the tsx/next binaries directly (not `npm run`) so a single Ctrl+C's
# `kill 0` reaches the real processes — npm swallows the signal and orphans them.
#
# The trigger-service runs leader election (Redis lock) for HA. Locally there's
# one instance, so `dev` clears any stale lock first — it leads immediately
# instead of waiting out a previous run's lock TTL after a crash/force-kill.
# Trigger health/liveness: http://localhost:4100/health.

.DEFAULT_GOAL := help
SHELL := /bin/bash
BIN := $(CURDIR)/node_modules/.bin
LEADER_LOCK := pulsar:leader:trigger-service

.PHONY: dev db down help

## dev: start DB, then run backend + worker + trigger + frontend together
dev: db
	@docker compose exec -T redis redis-cli DEL $(LEADER_LOCK) >/dev/null 2>&1 || true
	@echo "▶ Starting all services — press Ctrl+C to stop everything."
	@echo "  frontend :3000   backend :4000   trigger health :4100"
	@trap 'trap - INT TERM EXIT; echo; echo "■ Stopping services..."; kill 0' INT TERM EXIT; \
	( cd apps/backend         && exec $(BIN)/tsx watch src/index.ts ) 2>&1 | awk '{ print "[backend]  " $$0; fflush() }' & \
	( cd apps/worker          && exec $(BIN)/tsx watch src/index.ts ) 2>&1 | awk '{ print "[worker]   " $$0; fflush() }' & \
	( cd apps/trigger-service && exec $(BIN)/tsx watch src/index.ts ) 2>&1 | awk '{ print "[trigger]  " $$0; fflush() }' & \
	( cd apps/frontend        && exec $(BIN)/next dev               ) 2>&1 | awk '{ print "[frontend] " $$0; fflush() }' & \
	wait

## db: start Postgres + Redis (Docker) and wait until healthy
db:
	@docker compose up -d --wait
	@echo "✓ Postgres :5432 and Redis :6379 ready."

## down: stop the Docker DB layer (data preserved; add ARGS=-v to wipe)
down:
	@docker compose down $(ARGS)

## help: list available targets
help:
	@echo "Targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed -E 's/## /  /'
