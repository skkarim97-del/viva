# API Migration: Replit Autoscale -> EC2

## Goal

Move production API compute for `viva-ai.replit.app/api` to a single EC2
instance in the same AWS account that owns the RDS database, so the entire
PHI-processing path lives inside our AWS environment before the real-patient
pilot opens.

Out of scope on purpose (per "keep it simple"):

- ECS / EKS / Fargate / Kubernetes
- Terraform / CloudFormation / CDK
- Multi-AZ / load balancer / autoscaling group
- Blue/green or canary tooling beyond manual DNS cutover

## Decisions

- **Compute**: 1x EC2 `t3.small` (2 vCPU / 2 GiB RAM), Amazon Linux 2023, in
  the same VPC + same private subnet group as the RDS instance.
- **Process supervisor**: `systemd` unit (built into the OS, no extra deps).
- **Reverse proxy / TLS**: **Caddy 2** (single static binary, automatic
  Let's Encrypt cert + auto-renew, single-line config). Chosen over nginx +
  certbot to remove cert renewal as a separate moving part.
- **Node version**: 24.x (matches `.replit modules = ["nodejs-24"]`),
  installed via NodeSource.
- **Package manager**: pnpm 10.x via `corepack`.
- **Build location**: on the EC2 box (`pnpm install --frozen-lockfile` +
  `pnpm --filter @workspace/api-server run build`). The api-server bundle
  produced by esbuild plus the resolved `node_modules` is what runs.
- **DB driver**: existing `pg` Pool in `lib/db/src/index.ts`. Two opt-in
  paths now exist:
  1. `AWS_DATABASE_URL` set, `AWS_DB_SSL_CA_PATH` unset -> `sslmode=no-verify`
     (the legacy Replit Autoscale path; kept for back-compat).
  2. `AWS_DATABASE_URL` set, `AWS_DB_SSL_CA_PATH` pointed at the RDS CA
     bundle PEM file on disk -> `verify-full` with `rejectUnauthorized:
     true` and the bundle pinned. **This is the EC2 path.**
- **CORS allowlist**: `app.ts` now reads `ALLOWED_ORIGINS` (comma-separated
  origin list). When set, only those origins receive CORS headers from
  the API; when unset, the server reflects any origin (legacy behavior,
  preserves the current Replit deployment without a config change).
  Mobile native fetch never sends an `Origin` header so the allowlist
  has no effect on the iOS/Android app.
- **Secrets**: `/etc/viva-api.env` for the first cutover. AWS Secrets
  Manager / Parameter Store SecureString is documented as a follow-up
  hardening item in T111 and intentionally not wired into the runtime
  yet. We don't need the AWS SDK on the box on day one.
- **No schema changes.** This migration is hosting-layer only. `users.id`
  and every other PK stays the type it already is.

## Tasks

### T101: Provision EC2 instance + base OS hardening
- Blocked By: []
- Acceptance: SSH-able EC2 instance in the same VPC as RDS, baseline
  packages installed, swap configured, firewall in default-deny posture.
- Steps:
  1. Launch `t3.small`, Amazon Linux 2023, 20 GiB gp3 EBS, **encryption
     ON** (KMS, default `aws/ebs` key is fine for pilot).
  2. Place it in the **same VPC and one of the same subnets** as the RDS
     instance. Public subnet is fine for the pilot (Caddy needs port 443
     reachable from the internet for ACME HTTP-01 + serving traffic).
  3. Attach an IAM instance profile with **only**
     `AmazonSSMManagedInstanceCore` (so you can use SSM Session Manager
     instead of SSH, optional but recommended).
  4. Tag: `Name=viva-api-pilot`, `env=prod-pilot`, `app=viva-api`.
  5. After first boot:
     ```bash
     sudo dnf -y update
     sudo dnf -y install git tar gzip jq htop awscli
     # 2 GiB swap so the build doesn't OOM on t3.small
     sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
     sudo chmod 600 /swapfile
     sudo mkswap /swapfile && sudo swapon /swapfile
     echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
     ```

### T102: Install Node 24, pnpm, Caddy
- Blocked By: [T101]
- Acceptance: `node -v` reports v24.x, `pnpm -v` reports 10.x, `caddy version`
  reports v2.
- Steps:
  ```bash
  # Node 24 from NodeSource
  curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
  sudo dnf -y install nodejs

  # pnpm via corepack (ships with Node)
  sudo corepack enable
  sudo corepack prepare pnpm@10 --activate

  # Caddy 2 from the official COPR
  sudo dnf -y install 'dnf-command(copr)'
  sudo dnf -y copr enable @caddy/caddy
  sudo dnf -y install caddy
  ```

### T103: Create deploy user, clone repo, install + build
- Blocked By: [T102]
- Acceptance: `/opt/viva/api/artifacts/api-server/dist/index.mjs` exists
  and a manual `node --enable-source-maps dist/index.mjs` boots cleanly
  (with env vars set).
- Steps:
  ```bash
  sudo useradd -r -m -d /opt/viva -s /bin/bash viva
  sudo -u viva mkdir -p /opt/viva/api
  # Option A: deploy via git over HTTPS using a read-only deploy key
  sudo -u viva git clone <repo-url> /opt/viva/api
  cd /opt/viva/api
  sudo -u viva pnpm install --frozen-lockfile
  sudo -u viva pnpm --filter @workspace/api-server run build
  ```
  - Future deploys are `cd /opt/viva/api && git pull && pnpm install
    --frozen-lockfile && pnpm --filter @workspace/api-server run build &&
    sudo systemctl restart viva-api`.

### T104: Environment file + systemd unit
- Blocked By: [T103]
- Acceptance: `systemctl status viva-api` shows `active (running)`,
  `journalctl -u viva-api` shows the pino startup line, `curl
  http://127.0.0.1:8080/api/healthz` returns `{"status":"ok"}`.

#### Required environment variables

Write to `/etc/viva-api.env` (mode `0600`, owned by `root:viva`):

| Var | Required | Purpose | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | Production mode | `production` |
| `PORT` | yes | App listen port | `8080` |
| `LOG_LEVEL` | no | pino level | default `info` |
| `AWS_DATABASE_URL` | yes | RDS connection string | set this (not `DATABASE_URL`) so the SSL branch in `lib/db/src/index.ts` activates |
| `AWS_DB_SSL_CA_PATH` | yes on EC2 | Path to RDS CA bundle PEM | set to e.g. `/opt/viva/rds-ca-bundle.pem` to get `verify-full`; if omitted, falls back to `no-verify` |
| `ALLOWED_ORIGINS` | yes | Comma-separated browser-origin allowlist | e.g. `https://viva-ai.replit.app,https://dashboard.itsviva.com` -- only browser CORS, mobile native fetch is unaffected |
| `SESSION_SECRET` | yes | Signs doctor session cookies | generate with `openssl rand -hex 32` |
| `INTERNAL_API_KEY` | yes (operator routes) | Static operator bearer | generate with `openssl rand -hex 32` |
| `INTERNAL_IP_ALLOWLIST` | yes (operator routes) | Comma-separated **exact** IPv4/IPv6 addresses that can hit `/api/internal/*` (CIDR not supported by current middleware) | the office / VPN egress IPs |
| `COACH_PILOT_MODE` | yes for pilot | Coach mode | `safe` (defaults safe in production already, but be explicit) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | no in safe mode | OpenAI key | omit for the pilot; safe mode does not call OpenAI |
| `OPENAI_API_KEY` | no in safe mode | Legacy alias | omit |
| `APPLE_TEAM_ID` | yes | iOS associated-domain JSON | from Apple Developer |
| `ANDROID_APP_SIGNING_SHA256` | yes | Android assetlinks JSON | from Play Console |
| `VIVA_TESTFLIGHT_URL` | no | TestFlight redirect | already set in `.replit userenv.shared`, copy over |
| `COACH_STORE_RAW_MESSAGES` | no | Debug only | leave unset in pilot |

Pull the secret values out of the existing Replit deployment's environment
panel (do **not** echo them to the shell). The session secret can stay the
same value as Replit so existing doctor sessions survive cutover; if you
prefer a clean slate, rotate it and accept that all doctors will be
re-prompted to log in + re-MFA.

#### systemd unit

`/etc/systemd/system/viva-api.service`:

```ini
[Unit]
Description=Viva API server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=viva
Group=viva
WorkingDirectory=/opt/viva/api
EnvironmentFile=/etc/viva-api.env
ExecStart=/usr/bin/node --enable-source-maps /opt/viva/api/artifacts/api-server/dist/index.mjs
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/viva/api
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Enable + start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now viva-api
sudo journalctl -u viva-api -f
```

### T105: RDS connectivity (security group + TLS)
- Blocked By: [T101]
- Acceptance: from the EC2 box, `psql "$AWS_DATABASE_URL" -c 'select 1'`
  succeeds; the application boots and answers `/api/healthz`.
- Steps:
  1. Find the **RDS security group**. Add an inbound rule:
     - Protocol: TCP, port: 5432
     - Source: the **EC2 instance's security group ID** (not its IP).
       Using the SG-as-source means the rule survives instance replacement.
  2. Confirm the RDS instance has `Publicly accessible = No`. If it is
     currently public (because Replit needed it), flip it to private now;
     the EC2 reaches it over the VPC.
  3. **TLS verify-full with the RDS CA bundle** (now wired into the
     code as an opt-in via `AWS_DB_SSL_CA_PATH`):
     ```bash
     sudo -u viva curl -fsSL \
       https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
       -o /opt/viva/rds-ca-bundle.pem
     sudo chmod 0644 /opt/viva/rds-ca-bundle.pem
     ```
     Then add to `/etc/viva-api.env`:
     ```
     AWS_DB_SSL_CA_PATH=/opt/viva/rds-ca-bundle.pem
     ```
     `lib/db/src/index.ts` will read the bundle at startup, drop any
     `sslmode` from the URL, and pass `ssl: { ca, rejectUnauthorized:
     true }` to the pg Pool. If the file is missing or unreadable the
     process throws on startup with a clear error -- safer than silently
     downgrading.
  4. Quick sanity (uses the same bundle so it matches the app):
     ```bash
     sudo -u viva bash -c 'set -a; source /etc/viva-api.env; set +a;
       psql "$AWS_DATABASE_URL?sslmode=verify-full&sslrootcert=$AWS_DB_SSL_CA_PATH" \
         -c "select now(), current_user, version()"'
     ```

### T106: Caddy reverse proxy + TLS for api.itsviva.com
- Blocked By: [T104]
- Acceptance: `curl -I https://api.itsviva.com/api/healthz` returns 200
  with a valid Let's Encrypt cert, and the response body is
  `{"status":"ok"}`.
- Steps:
  1. Point DNS first (so Caddy's HTTP-01 challenge resolves):
     - In Route 53 (or wherever `itsviva.com` is hosted), set
       `api.itsviva.com` `A` record to the EC2 **Elastic IP** (allocate
       and associate one so the IP survives stop/start).
     - TTL 60s during the cutover so you can roll back fast.
  2. `/etc/caddy/Caddyfile`:
     ```
     api.itsviva.com {
         encode gzip
         reverse_proxy 127.0.0.1:8080 {
             header_up X-Forwarded-Proto {scheme}
             header_up X-Forwarded-For   {remote_host}
         }
         # Caddy logs to journald by default
     }
     ```
     The Express app already calls `app.set("trust proxy", 1)` so
     `req.ip` and `secure` cookies will be correct behind Caddy.
  3. ```bash
     sudo systemctl enable --now caddy
     sudo systemctl reload caddy
     sudo journalctl -u caddy -f
     ```
     Caddy will request and renew the cert automatically.

### T107: Security groups (firewall) summary
- Blocked By: [T101, T105, T106]
- Acceptance: only the intended ports are reachable from the intended
  sources; `nmap` from outside shows 80 + 443 only.

| SG | Inbound | Source | Reason |
|---|---|---|---|
| `viva-api-ec2` | TCP 443 | `0.0.0.0/0` | HTTPS for clients |
| `viva-api-ec2` | TCP 80 | `0.0.0.0/0` | ACME HTTP-01 + Caddy 80->443 redirect |
| `viva-api-ec2` | TCP 22 | your office/VPN /32 only | SSH (or skip and use SSM Session Manager) |
| `viva-rds` | TCP 5432 | `viva-api-ec2` (SG ref) | DB |

Outbound: leave the default "all" on the EC2 SG. RDS outbound stays
default-deny except the ephemeral return path.

### T108: Verify /api/healthz end-to-end
- Blocked By: [T106]
- Acceptance: all four checks pass.
- Steps:
  ```bash
  # 1. Local on the box (no proxy)
  curl -sS http://127.0.0.1:8080/api/healthz
  # 2. Through Caddy on localhost
  curl -sSI https://api.itsviva.com/api/healthz --resolve api.itsviva.com:443:127.0.0.1
  # 3. From the public internet (off the EC2 box)
  curl -sSI https://api.itsviva.com/api/healthz
  # 4. Cert chain
  echo | openssl s_client -connect api.itsviva.com:443 -servername api.itsviva.com 2>/dev/null \
    | openssl x509 -noout -issuer -subject -dates
  ```
  All should show HTTP/2 200 and the body `{"status":"ok"}`.

### T109: Cut mobile + dashboard over to api.itsviva.com
- Blocked By: [T108]
- Acceptance: a fresh mobile build talks to `api.itsviva.com`, dashboard
  in the browser hits `api.itsviva.com`, no requests in the new build go
  to `viva-ai.replit.app`.
- Code changes:
  1. **Mobile** -- `artifacts/pulse-pilot/lib/apiConfig.ts`:
     ```ts
     const PRODUCTION_API_URL = "https://api.itsviva.com/api";
     ```
     Bump `app.json` `ios.buildNumber` and `android.versionCode`. Submit
     new TestFlight build + Play internal track.
  2. **Mobile** -- `artifacts/pulse-pilot/app.json`:
     - `ios.associatedDomains`: `applinks:api.itsviva.com` (or keep both
       for the cutover window)
     - `android.intentFilters[].data.host`: add `api.itsviva.com`
  3. **Doctor dashboard** -- `artifacts/viva-dashboard`:
     - The dashboard uses a relative `/api` path. Two options:
       - **Easier:** keep serving the dashboard from Replit and add
         `VITE_API_BASE_URL=https://api.itsviva.com/api` to the dashboard
         build env. CORS on the API must then allow the dashboard origin.
       - **Cleaner:** also serve the dashboard from EC2 (Caddy can serve
         the static `dist/` from `dashboard.itsviva.com` as a separate
         site block). Dashboard then keeps its same-origin `/api`.
     - For pilot, pick the easier path.
  4. **CORS** -- the API now reads `ALLOWED_ORIGINS` from env. On the
     EC2 box, set:
     ```
     ALLOWED_ORIGINS=https://viva-ai.replit.app,https://dashboard.itsviva.com
     ```
     Include every browser origin that needs to attach the doctor
     session cookie. The mobile app sends no `Origin` header and is
     unaffected. Rejected origins are logged once per request as
     `cors_origin_rejected` so a misconfiguration shows up in the
     journal immediately.
  5. **iOS / Android associated domains JSON** -- the API serves
     `/.well-known/apple-app-site-association` and
     `/.well-known/assetlinks.json`. Confirm both still respond at
     `https://api.itsviva.com/.well-known/...` after cutover.

### T110: Rollback plan
- Blocked By: []
- Acceptance: a single DNS change brings traffic back to Replit within
  the TTL window with no data loss.
- Plan:
  1. **Before cutover, do not retire the Replit deployment.** Leave the
     Replit Autoscale deployment running and pointed at the same
     `AWS_DATABASE_URL`. Both backends share one database, so a flip in
     either direction is a no-op for data.
  2. Keep DNS TTL at 60 seconds during the cutover window.
  3. Cutover step is a single DNS change: `api.itsviva.com` A record
     swings between the EC2 Elastic IP and a `CNAME` to
     `viva-ai.replit.app`.
  4. **Mobile rollback is harder than DNS** because the prod URL is
     baked in at build time. Mitigation: ship the EC2-pointed build
     first to **TestFlight + Play internal only**. Only promote to App
     Store / Play production after `api.itsviva.com` has been stable for
     >= 7 days. If problems appear after promotion, the bake-in URL
     means rollback is "ship a fix build," not "flip DNS." For that
     reason, the safer pattern is to **point both `api.itsviva.com` and
     `viva-ai.replit.app` at the same backend during the bake-in
     window**, so the rollback path is purely DNS even for the new
     mobile build.
  5. Rollback signals to watch for in the first 24 hours:
     - Any 5xx rate > 0.5%
     - p95 healthz latency > 200 ms
     - DB connection errors in `journalctl -u viva-api`
     - `caddy` cert renewal failures
     - Doctor MFA verify failures > baseline

### T111: Post-cutover hardening checklist (do before real PHI)
- Blocked By: [T108]
- Acceptance: each item is signed off in writing.
- Items:
  - [ ] BAA in place with AWS (covers EC2 + RDS).
  - [ ] BAA in place with Replit if the Replit deployment stays alive
        as a hot standby.
  - [ ] Disable `Publicly accessible` on the RDS instance.
  - [ ] CloudWatch alarms on EC2 CPU, memory, disk, and instance status.
  - [ ] EBS daily snapshot policy + RDS automated backup retention >= 35
        days.
  - [ ] Restore-from-snapshot drill: spin up a throwaway RDS from
        snapshot, run a smoke test, tear down. Document timing.
  - [ ] Confirm `AWS_DB_SSL_CA_PATH` is set in `/etc/viva-api.env` and
        the journal shows no SSL fall-through warnings (code change
        already landed in `lib/db/src/index.ts`).
  - [ ] Rotate `SESSION_SECRET` and `INTERNAL_API_KEY` once during
        cutover and migrate both to AWS Secrets Manager or Parameter
        Store SecureString. The `EnvironmentFile=` line in the systemd
        unit can be replaced with a small `ExecStartPre=` that pulls
        the secrets via the AWS CLI and writes them to a tmpfs file --
        deferred until after the first stable cutover so we don't
        change two things at once.
  - [ ] CloudWatch Logs agent on the EC2 box, shipping
        `journalctl -u viva-api` to a log group with retention >= 6
        years (HIPAA audit log requirement).
  - [ ] Confirm `phi_access_logs` rows are being written from the EC2
        instance, not just the Replit instance, before flipping the
        mobile build over.
  - [ ] AWS GuardDuty enabled in the account.
  - [ ] Run the existing browser e2e + backend smoke test suite against
        `https://api.itsviva.com`.

## Time estimate

End-to-end, with no surprises and one experienced operator: ~1 working day
of focused effort, broken roughly into 2 hours infra (T101+T102+T105),
2 hours app deploy + Caddy (T103+T104+T106), 1 hour verification (T108),
and 2 hours mobile/dashboard cutover prep (T109). T111 hardening adds
another day spread across the week.

## What is intentionally not in this plan

- A second EC2 / load balancer for HA. A single `t3.small` is enough for
  pilot traffic; HA is a follow-up after pilot data shows the load shape.
- Container packaging. We ship the same monorepo we already build today.
- IaC. Everything above is documented as runbook steps; codifying it can
  come once the shape settles.
