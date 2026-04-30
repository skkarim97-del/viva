#!/usr/bin/env bash
# scripts/ec2/inspect.sh
#
# Run this FIRST on the existing EC2 instance to figure out whether we can
# deploy onto it or whether we should start over with a fresh box.
#
# Usage on the EC2 box (as the default ec2-user / ubuntu user):
#   curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/scripts/ec2/inspect.sh | bash
# or, if you've already cloned the repo:
#   bash scripts/ec2/inspect.sh
#
# This script ONLY reads. It does not install or modify anything.
# Copy/paste its output back to the chat so we can decide the next step.

set -uo pipefail

line() { printf '\n----- %s -----\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "===== VIVA EC2 INSPECTION REPORT ====="
echo "Generated: $(date -u +%FT%TZ)"
echo "Hostname:  $(hostname)"

line "OS / kernel / architecture"
if [ -r /etc/os-release ]; then
  cat /etc/os-release
else
  echo "/etc/os-release missing -- this is unusual"
fi
echo
uname -a

line "CPU / memory / disk"
if have nproc; then echo "CPU cores: $(nproc)"; fi
if have free; then free -h; fi
if have df; then df -hT /; fi

line "Existing services on tcp ports 80 / 443 / 8080"
if have ss; then
  sudo ss -tlnp 2>/dev/null | grep -E ':(80|443|8080)\b' || echo "(none listening)"
elif have netstat; then
  sudo netstat -tlnp 2>/dev/null | grep -E ':(80|443|8080)\b' || echo "(none listening)"
else
  echo "(no ss or netstat installed)"
fi

line "Tools already installed"
for cmd in git curl node pnpm corepack caddy nginx psql systemctl; do
  if have "$cmd"; then
    v=$("$cmd" --version 2>&1 | head -1 || echo "?")
    printf '  %-10s %s\n' "$cmd" "$v"
  else
    printf '  %-10s NOT INSTALLED\n' "$cmd"
  fi
done

line "Existing viva user / paths"
id viva 2>/dev/null || echo "user 'viva' does not exist (good for a fresh setup)"
[ -d /opt/viva ] && ls -la /opt/viva || echo "/opt/viva does not exist (good for a fresh setup)"
[ -f /etc/viva-api.env ] && echo "/etc/viva-api.env exists (size $(stat -c%s /etc/viva-api.env) bytes)" || echo "/etc/viva-api.env does not exist"
[ -f /etc/systemd/system/viva-api.service ] && echo "viva-api.service already installed" || echo "viva-api.service not installed yet"

line "Outbound connectivity sanity"
if have curl; then
  curl -fsSI -m 5 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem >/dev/null \
    && echo "RDS CA bundle reachable: OK" || echo "RDS CA bundle NOT reachable (check egress / NAT)"
  curl -fsSI -m 5 https://registry.npmjs.org/ >/dev/null \
    && echo "npm registry reachable:  OK" || echo "npm registry NOT reachable"
fi

line "Public IPv4 (what DNS will point at)"
if have curl; then
  PUB=$(curl -fsS -m 5 -H "X-aws-ec2-metadata-token-ttl-seconds: 60" \
    -X PUT http://169.254.169.254/latest/api/token 2>/dev/null \
    | xargs -I{} curl -fsS -m 5 -H "X-aws-ec2-metadata-token: {}" \
      http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null) || PUB=""
  if [ -n "$PUB" ]; then
    echo "Public IPv4: $PUB"
  else
    echo "Could not read IMDSv2 -- find the Public IPv4 in the EC2 console under your instance details."
  fi
fi

echo
echo "===== END REPORT ====="
echo "Send this whole output back so we can pick the next step."
