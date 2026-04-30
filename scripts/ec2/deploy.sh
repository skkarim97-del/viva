#!/usr/bin/env bash
# scripts/ec2/deploy.sh
#
# Pull (or first-time clone), build, and restart the viva-api service.
# Idempotent: safe to re-run for every deploy.
#
# Inputs (env vars):
#   GIT_REPO_URL  required on first run, ignored afterward
#   GIT_BRANCH    optional, default: main
#   GIT_REF       optional, specific commit SHA to check out (overrides BRANCH)
#
# Run as root:
#   sudo GIT_REPO_URL=https://github.com/<org>/<repo>.git bash scripts/ec2/deploy.sh
#
# After first run, subsequent deploys are simply:
#   sudo bash /opt/viva/app/scripts/ec2/deploy.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run with sudo: sudo bash $0" >&2
  exit 1
fi

APP_DIR=/opt/viva/app
GIT_BRANCH="${GIT_BRANCH:-main}"

step() { printf '\n==> %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. First-time clone, or pull on subsequent runs
# ---------------------------------------------------------------------------
if [ ! -d "$APP_DIR/.git" ]; then
  if [ -z "${GIT_REPO_URL:-}" ]; then
    echo "ERROR: GIT_REPO_URL must be set on first run." >&2
    echo "Example:" >&2
    echo "  sudo GIT_REPO_URL=https://github.com/<org>/<repo>.git bash $0" >&2
    exit 1
  fi
  step "Cloning $GIT_REPO_URL (branch $GIT_BRANCH) into $APP_DIR"
  rm -rf "$APP_DIR"
  install -d -o viva -g viva -m 0755 "$APP_DIR"
  sudo -u viva git clone --branch "$GIT_BRANCH" --depth 50 "$GIT_REPO_URL" "$APP_DIR"
else
  step "Pulling latest from origin/$GIT_BRANCH"
  sudo -u viva git -C "$APP_DIR" fetch --prune origin
  sudo -u viva git -C "$APP_DIR" checkout "$GIT_BRANCH"
  sudo -u viva git -C "$APP_DIR" reset --hard "origin/$GIT_BRANCH"
fi

if [ -n "${GIT_REF:-}" ]; then
  step "Checking out pinned ref $GIT_REF"
  sudo -u viva git -C "$APP_DIR" checkout "$GIT_REF"
fi

REV=$(sudo -u viva git -C "$APP_DIR" rev-parse --short HEAD)
step "Deploying revision $REV"

# ---------------------------------------------------------------------------
# 2. Install + build
# ---------------------------------------------------------------------------
step "pnpm install --frozen-lockfile"
sudo -u viva bash -lc "cd $APP_DIR && pnpm install --frozen-lockfile"

step "Building api-server"
sudo -u viva bash -lc "cd $APP_DIR && NODE_ENV=production pnpm --filter @workspace/api-server run build"

# ---------------------------------------------------------------------------
# 3. Restart the service and verify health
# ---------------------------------------------------------------------------
step "Restarting viva-api"
systemctl restart viva-api

# Give it a moment to boot
sleep 3

step "Service status"
systemctl --no-pager --lines=20 status viva-api || true

step "Health check"
if curl -fsS http://127.0.0.1:8080/api/healthz; then
  echo
  echo "==> deploy OK -- revision $REV is serving on :8080"
else
  echo
  echo "ERROR: /api/healthz did not respond. Investigate with:" >&2
  echo "  sudo journalctl -u viva-api -n 100 --no-pager" >&2
  exit 1
fi
