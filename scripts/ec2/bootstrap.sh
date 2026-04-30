#!/usr/bin/env bash
# scripts/ec2/bootstrap.sh
#
# One-shot setup for a fresh Amazon Linux 2023 (or Ubuntu 22.04+) EC2
# instance. Idempotent: safe to re-run.
#
# Installs:
#   - Node.js 24 (NodeSource)
#   - pnpm 10 (via corepack)
#   - Caddy 2 (official repo)
#   - git
#   - the 'viva' system user
#   - /opt/viva (owned by viva)
#   - /etc/viva-api.env (skeleton, mode 0600)
#   - /etc/systemd/system/viva-api.service
#   - /etc/caddy/Caddyfile (reverse proxy stub)
#
# Does NOT yet:
#   - clone the app code (deploy.sh does that)
#   - download the RDS CA bundle (you do that after editing the env file)
#   - start viva-api (it will fail until /etc/viva-api.env is filled in)
#
# Run as root:
#   sudo bash scripts/ec2/bootstrap.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: run with sudo: sudo bash $0" >&2
  exit 1
fi

step() { printf '\n==> %s\n' "$1"; }

# ---------------------------------------------------------------------------
# 1. Detect OS family
# ---------------------------------------------------------------------------
. /etc/os-release
case "$ID" in
  amzn|rhel|centos|fedora|rocky|almalinux) PKG=dnf ;;
  ubuntu|debian)                            PKG=apt ;;
  *) echo "Unsupported OS: $ID. Tested on Amazon Linux 2023 and Ubuntu 22.04+."; exit 1 ;;
esac
step "Detected OS: $PRETTY_NAME (using $PKG)"

# Set time sync if not already running -- TLS certs and TOTP both need
# accurate clocks. Most cloud images already have this; guard idempotently.
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl set-ntp true 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 1.5 Swap file (idempotent). pnpm install + esbuild on a t3.small with
#     only 2 GB RAM will OOM during the build. 2 GB swap is enough headroom.
# ---------------------------------------------------------------------------
if [ ! -f /swapfile ]; then
  step "Creating 2 GB swap file at /swapfile"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  if ! grep -q '^/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  # Lower swappiness so we only swap under genuine pressure.
  sysctl -w vm.swappiness=10 >/dev/null
  if [ ! -f /etc/sysctl.d/99-viva-swap.conf ]; then
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-viva-swap.conf
  fi
else
  step "/swapfile already exists -- skipping swap setup"
fi

# ---------------------------------------------------------------------------
# 2. Base packages
# ---------------------------------------------------------------------------
step "Installing base packages (curl, git, ca-certificates, postgresql client)"
if [ "$PKG" = dnf ]; then
  dnf install -y curl git ca-certificates tar gzip postgresql15
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl git ca-certificates debian-keyring debian-archive-keyring \
    apt-transport-https gnupg lsb-release postgresql-client
fi

# ---------------------------------------------------------------------------
# 3. Node.js 24 via NodeSource
# ---------------------------------------------------------------------------
NODE_MAJOR=24
if ! command -v node >/dev/null || [ "$(node -v 2>/dev/null | cut -c2- | cut -d. -f1)" != "$NODE_MAJOR" ]; then
  step "Installing Node.js $NODE_MAJOR via NodeSource"
  if [ "$PKG" = dnf ]; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    dnf install -y nodejs
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
else
  step "Node.js $(node -v) already installed -- skipping"
fi

# ---------------------------------------------------------------------------
# 4. pnpm 10 via corepack
# ---------------------------------------------------------------------------
step "Enabling corepack and pinning pnpm@10"
corepack enable
corepack prepare pnpm@10 --activate

# ---------------------------------------------------------------------------
# 5. Caddy 2 via official repo
# ---------------------------------------------------------------------------
if ! command -v caddy >/dev/null; then
  step "Installing Caddy from official Cloudsmith repo"
  if [ "$PKG" = dnf ]; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/setup.rpm.sh | bash
    dnf install -y caddy
  else
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
else
  step "Caddy $(caddy version | head -1) already installed -- skipping"
fi

# ---------------------------------------------------------------------------
# 6. Create 'viva' system user + paths
# ---------------------------------------------------------------------------
if ! id viva >/dev/null 2>&1; then
  step "Creating system user 'viva'"
  useradd --system --create-home --home-dir /home/viva --shell /usr/sbin/nologin viva
fi

step "Ensuring /opt/viva exists and is owned by viva"
install -d -o viva -g viva -m 0755 /opt/viva
install -d -o viva -g viva -m 0755 /opt/viva/app

# ---------------------------------------------------------------------------
# 7. /etc/viva-api.env skeleton (only if missing -- never overwrite a real one)
# ---------------------------------------------------------------------------
if [ ! -f /etc/viva-api.env ]; then
  step "Writing /etc/viva-api.env skeleton (you MUST fill this in before starting the API)"
  install -m 0600 -o root -g root /dev/null /etc/viva-api.env
  cat > /etc/viva-api.env <<'ENV'
# /etc/viva-api.env -- runtime environment for viva-api.service
# Mode 0600, owned by root. Read by systemd, NOT exported to other users.
#
# Fill in every value below, then:
#   sudo systemctl restart viva-api
#   sudo systemctl status  viva-api

NODE_ENV=production
PORT=8080
LOG_LEVEL=info

# --- Database (AWS RDS) -----------------------------------------------------
# Use AWS_DATABASE_URL (NOT DATABASE_URL) so the SSL branch in lib/db
# activates. Format:
#   postgresql://USER:PASSWORD@HOST:5432/DBNAME
AWS_DATABASE_URL=

# Path to the RDS CA bundle on disk. Run this once as the viva user:
#   sudo -u viva curl -fsSL \
#     https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
#     -o /opt/viva/rds-ca-bundle.pem
AWS_DB_SSL_CA_PATH=/opt/viva/rds-ca-bundle.pem

# --- Browser CORS allowlist -------------------------------------------------
# Comma-separated list of every browser origin that talks to /api.
# Mobile native fetch sends no Origin header so it is unaffected.
ALLOWED_ORIGINS=https://viva-ai.replit.app,https://dashboard.viva-ai.com

# --- Sessions / operator auth ----------------------------------------------
# Generate fresh values for the EC2 cutover:
#   openssl rand -hex 32
SESSION_SECRET=
INTERNAL_API_KEY=
# EXACT IPv4 / IPv6 addresses only, comma-separated. CIDR ranges are NOT
# supported -- the middleware does an exact set membership check. If you
# leave this blank the operator endpoints are open to any IP (logged loudly
# at startup); set it before you serve real traffic.
INTERNAL_IP_ALLOWLIST=

# --- Coach pilot mode (locked to 'safe' for HIPAA pilot) -------------------
COACH_PILOT_MODE=safe

# --- Mobile associated domains JSON ----------------------------------------
APPLE_TEAM_ID=
ANDROID_APP_SIGNING_SHA256=
ENV
  chmod 0600 /etc/viva-api.env
else
  step "/etc/viva-api.env already exists -- not touching it"
fi

# ---------------------------------------------------------------------------
# 8. systemd unit
# ---------------------------------------------------------------------------
if [ -f "$REPO_ROOT/scripts/ec2/viva-api.service" ]; then
  step "Installing /etc/systemd/system/viva-api.service from repo"
  install -m 0644 -o root -g root \
    "$REPO_ROOT/scripts/ec2/viva-api.service" \
    /etc/systemd/system/viva-api.service
else
  echo "WARNING: $REPO_ROOT/scripts/ec2/viva-api.service not found." >&2
  echo "If you ran bootstrap via curl-pipe, also fetch the .service file:" >&2
  echo "  sudo curl -fsSL .../scripts/ec2/viva-api.service \\" >&2
  echo "    -o /etc/systemd/system/viva-api.service" >&2
fi

# ---------------------------------------------------------------------------
# 9. Caddyfile
# ---------------------------------------------------------------------------
if [ ! -f /etc/caddy/Caddyfile.viva-installed ]; then
  step "Installing /etc/caddy/Caddyfile (reverse proxy for api.viva-ai.com)"
  install -d -m 0755 /etc/caddy
  if [ -f "$REPO_ROOT/scripts/ec2/Caddyfile.example" ]; then
    install -m 0644 -o root -g root \
      "$REPO_ROOT/scripts/ec2/Caddyfile.example" /etc/caddy/Caddyfile
  fi
  touch /etc/caddy/Caddyfile.viva-installed
fi

# ---------------------------------------------------------------------------
# 10. Enable services (start them only when configs are ready)
# ---------------------------------------------------------------------------
step "Reloading systemd and enabling services"
systemctl daemon-reload
systemctl enable caddy   >/dev/null
systemctl enable viva-api >/dev/null

# ---------------------------------------------------------------------------
# 11. Done -- print next steps
# ---------------------------------------------------------------------------
cat <<'NEXT'

==> bootstrap complete.

Next steps (in this order):

  1. Edit /etc/viva-api.env and fill in every blank value:
       sudo nano /etc/viva-api.env

  2. As the viva user, download the RDS CA bundle:
       sudo -u viva curl -fsSL \
         https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
         -o /opt/viva/rds-ca-bundle.pem

  3. Deploy the app code (see scripts/ec2/deploy.sh):
       sudo GIT_REPO_URL=https://github.com/<org>/<repo>.git \
         bash scripts/ec2/deploy.sh

  4. Once api.viva-ai.com DNS points at this box, start Caddy:
       sudo systemctl start caddy
       sudo systemctl status caddy
       curl -I https://api.viva-ai.com/api/healthz

NEXT
