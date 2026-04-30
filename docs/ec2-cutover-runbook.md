# EC2 cutover runbook (click-by-click)

This is the operator-facing companion to `docs/ec2-migration-plan.md`. The
plan explains _why_; this runbook is the _what to click and what to type_,
in order, with what you should see at each step.

The three shell scripts in `scripts/ec2/` do all the actual work. This
runbook only tells you when to run each one and what to do in the AWS
console between them.

> **Keep Replit running the whole time.** Nothing in this runbook touches
> the existing Replit Autoscale deployment. The mobile app and dashboard
> keep talking to `viva-ai.replit.app` until the very last phase. If
> anything goes wrong on EC2 you simply do not flip DNS, and users see
> zero impact.

---

## Phase 0 — Things you need before starting

- [ ] AWS Console login with permission to:
      - View / start / stop EC2 instances
      - Edit Security Groups
      - View RDS instance details (endpoint, port, SG)
- [ ] SSH or SSM Session Manager access to the EC2 box.
      (SSM is preferred -- no SSH key to manage. From the EC2 console:
      select the instance -> Connect -> Session Manager -> Connect.)
- [ ] Login to whoever hosts `itsviva.com` DNS (see Phase 1).
- [ ] A GitHub repo (or other git remote) with this monorepo pushed up,
      reachable from the EC2 box. The deploy script clones from it.
- [ ] About 60 minutes of focused time. Most of it is waiting.

---

## Phase 1 — Confirm Squarespace is hosting itsviva.com DNS

You told me itsviva.com is registered through Squarespace. Quick
verification before we start (run from any terminal):

```bash
nslookup -type=NS itsviva.com
```

If the output mentions `squarespacedns.com` (e.g. `ns-cloud-d1.squarespacedns.com`)
or `domains.squarespace.com`, you're set. If it shows something else
(e.g. `awsdns-...`, `cloudflare.com`), DNS has been moved to a third
party even though the registrar is Squarespace -- in that case paste the
output in chat and I'll switch the Phase 8 instructions to that
provider.

Now log into Squarespace at <https://account.squarespace.com>:

1. Click **Domains** in the left sidebar.
2. Click **itsviva.com**.
3. Click **DNS** (or **DNS Settings** in older UI).

You should see the existing records (probably A records pointing at
Squarespace's web hosts plus their email MX records). **Don't change
anything yet.** We will add exactly one new A record for `api` in
Phase 8.

---

## Phase 2 — Inspect the existing EC2 instance

1. In the AWS Console, go to **EC2 -> Instances**, find the existing
   instance, and note down:
   - Instance ID (e.g. `i-0abc123...`)
   - Public IPv4 address
   - Region
   - Security group(s) attached
2. Click **Connect -> Session Manager -> Connect**. You'll get a browser
   shell as `ssm-user`.
3. Paste this single command:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/scripts/ec2/inspect.sh | bash
   ```

   (Replace `<your-org>/<your-repo>` with your actual GitHub path. If the
   repo is private, instead clone it first with a deploy key or paste the
   script body directly.)

4. **Copy the entire output** and paste it back to me in chat. I'll tell
   you whether to keep this instance or wipe it.

What I'm looking for in the output:
- Is it Amazon Linux 2023 or Ubuntu? (Both supported.)
- At least 2 GB RAM, 10 GB free disk.
- Nothing already listening on 80 / 443 / 8080.
- Outbound HTTPS works (RDS CA bundle + npm registry both reachable).

If the box is in a usable state, continue with Phase 3 on the same box.
If it's a mess (random services running, full disk, weird OS), I'll have
you launch a fresh `t3.small` Amazon Linux 2023 instance and we'll bootstrap
that one instead.

---

## Phase 3 — Bootstrap the EC2 box (one command)

Still in the EC2 shell:

```bash
# clone the repo somewhere temporary just so bootstrap.sh has its sibling files
sudo dnf install -y git || sudo apt-get install -y git
git clone https://github.com/<your-org>/<your-repo>.git /tmp/viva-repo
cd /tmp/viva-repo
sudo bash scripts/ec2/bootstrap.sh
```

This installs Node 24, pnpm, Caddy, creates the `viva` system user and
`/opt/viva`, drops in a systemd service file and a Caddyfile, and writes
a skeleton `/etc/viva-api.env`.

You should see `==> bootstrap complete.` followed by next-step instructions.

**Nothing is serving traffic yet.** That's correct.

---

## Phase 4 — Fill in `/etc/viva-api.env`

```bash
sudo nano /etc/viva-api.env
```

Fill in:

- `AWS_DATABASE_URL` — the full Postgres connection string for your RDS
  instance. Get this from RDS console -> your DB -> "Endpoint & port",
  combined with the master username and password you set when you
  created the DB. Format:
  `postgresql://USERNAME:PASSWORD@your-db.xxxx.us-east-1.rds.amazonaws.com:5432/postgres`
- `SESSION_SECRET` — generate fresh:
  ```bash
  openssl rand -hex 32
  ```
  Paste the output. **Don't reuse the Replit one** -- this is a new
  trust boundary, rotate it.
- `INTERNAL_API_KEY` — same: `openssl rand -hex 32`. Paste.
- `INTERNAL_IP_ALLOWLIST` — comma-separated **exact** IPv4 or IPv6
  addresses that may hit `/api/internal/*`. **CIDR is NOT supported** by
  the current middleware -- it does an exact set match. For the pilot,
  set this to your office IP and your laptop's home IP. You can find your
  current IP at <https://ifconfig.me>. If you leave this blank the
  operator endpoints accept any source IP (the API logs a loud warning
  at startup so this never goes unnoticed).
- `APPLE_TEAM_ID` and `ANDROID_APP_SIGNING_SHA256` — copy these from
  whatever they're set to on Replit today. (They serve the iOS / Android
  associated-domains JSON files and need to match the shipped app.)

Save (Ctrl-O, Enter, Ctrl-X).

Now download the RDS CA bundle as the `viva` user:

```bash
sudo -u viva curl -fsSL \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o /opt/viva/rds-ca-bundle.pem
ls -l /opt/viva/rds-ca-bundle.pem
```

The file should be ~270 KB.

---

## Phase 5 — Allow the EC2 to reach RDS

In the AWS Console:

1. **EC2 -> Security Groups** -> note the SG attached to your EC2 box
   (something like `sg-0aaa...`).
2. **RDS -> Databases -> your DB -> Connectivity & security tab** -> note
   the SG attached to RDS.
3. Click that RDS security group, **Edit inbound rules**, and add:
   - Type: PostgreSQL
   - Port: 5432
   - Source: **the EC2 SG ID** (paste `sg-0aaa...`). Do NOT use 0.0.0.0/0.
4. Save.

Then test from the EC2 box:

```bash
sudo -u viva bash -c '
  set -a; source /etc/viva-api.env; set +a;
  psql "$AWS_DATABASE_URL?sslmode=verify-full&sslrootcert=$AWS_DB_SSL_CA_PATH" \
    -c "select now(), current_user, version();"
'
```

You should see one row of output with the current time and PG version.
If you see "could not connect" -> SG rule is wrong. If you see "SSL"
errors -> the CA path is wrong.

---

## Phase 6 — Deploy the API code (one command)

```bash
sudo GIT_REPO_URL=https://github.com/<your-org>/<your-repo>.git \
  bash /tmp/viva-repo/scripts/ec2/deploy.sh
```

This clones into `/opt/viva/app`, runs `pnpm install`, builds the API
bundle with esbuild, restarts `viva-api`, and curls `/api/healthz`.

You should see `==> deploy OK -- revision <sha> is serving on :8080`.

If health check fails:

```bash
sudo journalctl -u viva-api -n 100 --no-pager
```

Paste the last 50 lines back to me.

---

## Phase 7 — Open the EC2 to the internet on 80 + 443

Back in the AWS Console -> EC2 -> Security Groups -> the SG attached to
the EC2 box -> **Edit inbound rules** -> add:

- Type: HTTP,  Port 80,  Source: 0.0.0.0/0
- Type: HTTPS, Port 443, Source: 0.0.0.0/0
- (Optionally) keep Type: SSH, Port 22 restricted to your IP, or remove
  it entirely if you're using SSM Session Manager.

---

## Phase 8 — Point api.itsviva.com at the EC2 box (Squarespace)

**Important:** before this step, the Replit deployment at
`viva-ai.replit.app` is still serving 100% of mobile + dashboard
traffic. Adding a new `api` subdomain does **not** change anything that
is already working -- it just makes a brand new hostname resolve. The
cutover decision happens in Phase 11, not here.

In Squarespace (<https://account.squarespace.com> -> **Domains** ->
**itsviva.com** -> **DNS**):

1. Scroll to **Custom Records** (older UI: **Add Custom Record**).
2. Add one row:
   - **Host**: `api`
   - **Type**: `A`
   - **Data** (or **Value** / **Points to**): the EC2 instance's Public
     IPv4 from Phase 2 (e.g. `54.123.45.67`).
   - **TTL**: pick the lowest Squarespace allows (commonly 4 minutes /
     **240 seconds** -- Squarespace does not let you go to 60s).
3. Click **Add** / **Save**.

Squarespace will not let you delete or modify their default `A` records
for `itsviva.com` apex / `www` -- that's fine, we only need the new
`api` row. Leave the existing rows alone.

Wait 2-5 minutes for propagation, then from any computer:

```bash
nslookup api.itsviva.com
# Non-authoritative answer:
# Name:   api.itsviva.com
# Address: 54.123.45.67    <- should match your EC2 public IP
```

If it returns no record or the wrong IP, wait another 5 minutes (DNS
caches can be slow even with a low TTL) and retry. **Do not proceed to
Phase 9 until nslookup returns the right IP** -- Caddy's cert request
will fail otherwise.

---

## Phase 9 — Start Caddy and watch the cert get issued

Back on the EC2 box:

```bash
sudo systemctl start caddy
sudo systemctl status caddy
sudo journalctl -u caddy -f
```

In the live log you should see Caddy contacting Let's Encrypt and getting
a cert for `api.itsviva.com` within ~30 seconds. Press Ctrl-C to exit the
follow.

From your laptop:

```bash
curl -I https://api.itsviva.com/api/healthz
# -> HTTP/2 200
```

If you get a cert error, the most common causes are:
- DNS hasn't propagated yet (wait 2 more minutes, retry)
- Port 80 is blocked (re-check the SG inbound rules in Phase 7)
- The Caddy log shows the actual error -- paste it to me

---

## Phase 10 — Smoke test against the new domain

These four checks confirm the new backend is healthy *before* we point
any user traffic at it:

```bash
# 1. Healthz
curl -s https://api.itsviva.com/api/healthz
# -> {"status":"ok"}

# 2. iOS associated-domains JSON (used for universal links)
curl -s https://api.itsviva.com/.well-known/apple-app-site-association | head

# 3. Android assetlinks JSON
curl -s https://api.itsviva.com/.well-known/assetlinks.json | head

# 4. Operator IP allowlist sanity (run this from the SAME machine whose IP
#    you put in INTERNAL_IP_ALLOWLIST). Replace YOUR_OPERATOR_KEY with the
#    INTERNAL_API_KEY value. Should return 200 + JSON, not 403.
curl -s -H "Authorization: Bearer YOUR_OPERATOR_KEY" \
  https://api.itsviva.com/api/internal/healthz
# Then run the same command from any OTHER IP -- it must return
# {"error":"forbidden_ip"}. If the off-allowlist call succeeds, your
# allowlist is empty or wrong; fix /etc/viva-api.env and `sudo systemctl
# restart viva-api` before continuing.
```

All four should behave as described.

> **At this point you are done with the AWS-side work.** EC2 is serving,
> Caddy is fronting it, RDS is reachable, healthz is green at the new
> domain. Replit is still serving the live mobile app and dashboard. No
> users have been moved.

---

## Phase 11 — Cut the dashboard over (low risk, easy rollback)

The dashboard uses a relative `/api`, so it just needs to be served from
a host whose `/api` lives on EC2. Two ways:

**Option A — keep dashboard on Replit, change one env var:** Set
`VITE_API_BASE_URL=https://api.itsviva.com/api` on the Replit dashboard
deployment and redeploy. Then verify the doctor login flow works.

**Option B — host the dashboard on EC2 too:** Build the dashboard
locally, scp the `dist/` to `/opt/viva/dashboard`, add a second site
block to the Caddyfile for `dashboard.itsviva.com`. Cleaner for the
long term but more work.

For pilot, **Option A** is fine. Pick that, push the change, and:

1. Open the dashboard in an incognito window.
2. Log in as a doctor account.
3. Pass MFA.
4. Confirm the patient list loads.
5. Open one patient -> confirm care events / interventions render.
6. Check Chrome devtools -> Network -> requests are going to
   `api.itsviva.com`, returning 200, with `Access-Control-Allow-Origin`
   set to your dashboard origin.

If anything is off, revert the env var, redeploy, you're back on Replit.

---

## Phase 12 — Cut the mobile app over (highest risk, slowest rollback)

This is the only phase that requires a new app build, so it has a
multi-day TestFlight bake.

1. Edit `artifacts/pulse-pilot/lib/apiConfig.ts`:
   ```diff
   - const PRODUCTION_API_URL = "https://viva-ai.replit.app/api";
   + const PRODUCTION_API_URL = "https://api.itsviva.com/api";
   ```
   That single line is the entire change. The hardcoded constant is
   intentional -- it cannot be redirected by an EAS secret or stray env.
2. Update `artifacts/pulse-pilot/app.json` -- find every reference to
   `viva-ai.replit.app` in `associatedDomains` and `intentFilters` and
   replace with `api.itsviva.com`.
3. **Critically: keep both URLs serving the same backend during the
   bake-in window.** Until every TestFlight tester has the new build,
   the *old* app on their phone is still hitting `viva-ai.replit.app`,
   and the *new* one is hitting `api.itsviva.com`. Both must work and
   point at the same database. Easiest way: leave the Replit deployment
   running untouched -- it already talks to the same RDS instance.
4. EAS build + TestFlight push:
   ```bash
   cd artifacts/pulse-pilot
   eas build --platform all --profile production
   eas submit --platform ios   --latest
   eas submit --platform android --latest
   ```
5. Bake on TestFlight / internal track for **at least 7 days** with at
   least 3 testers exercising onboarding, login, MFA, coach (safe mode),
   care events, push notifications.
6. Once stable: promote to App Store / Play Store production.
7. After the rollout has ~95% adoption, you may sunset the Replit
   deployment. Don't rush this.

---

## Rollback playbook

The rollback story depends on _which_ phase you've reached. Be honest
with yourself about which one applies before you act -- the mobile
rollback is genuinely slow.

| What broke                       | Rollback                                                        |
|----------------------------------|-----------------------------------------------------------------|
| EC2 / Caddy / API on EC2 (Phases 3-10) | Don't flip DNS, don't change the dashboard env var, don't ship a mobile build. The Replit deployment is still serving 100% of users. Fix EC2 at your leisure. |
| Dashboard after Phase 11         | Unset `VITE_API_BASE_URL` on the Replit dashboard deployment, redeploy. Doctors are back on Replit within seconds of the redeploy. |
| Mobile after Phase 12 — already-installed builds | **DNS rollback does NOT help.** Old builds have `viva-ai.replit.app` baked in and keep working as long as Replit is up. New builds have `api.itsviva.com` baked in and stop working only if EC2 is down. The fix is to keep BOTH domains serving the same database (Replit + EC2 both pointed at the same RDS) for the entire bake-in window so neither cohort breaks. |
| Mobile after Phase 12 — broken new build | Submit a hotfix mobile build that reverts the URL constant and expedite-review through TestFlight / Play console. There is no faster path; this is why Phase 12 has a 7-day bake. |
| Mobile after Phase 12 — EC2 emergency | Point `api.itsviva.com` DNS at the Replit edge **only if** Replit's edge serves your origin (it doesn't via raw IP -- you'd need a CNAME to `viva-ai.replit.app` and that depends on Replit's TLS SAN coverage; verify before you rely on it). Safer assumption: there is no DNS-only rollback for the mobile cohort, only "keep Replit alive" + "ship a hotfix." |

The two non-negotiable rules during the mobile bake-in window:

1. **Keep Replit running.** Don't shut it down, don't change its
   `AWS_DATABASE_URL`, don't rotate its `SESSION_SECRET`.
2. **Both Replit and EC2 must point at the same RDS instance.** A user
   whose phone has the new build and a user whose phone has the old
   build are both real users in your database. They can't end up on
   different databases or you have a data fork.

Plan to keep this state for at least two weeks past 95% mobile adoption
of the new build before you decommission Replit.

---

## What to send me as you go

After each phase, paste back:
- Phase 2: full output of `inspect.sh`
- Phase 3: last 20 lines of bootstrap output
- Phase 5: the `psql` query result
- Phase 6: full output of `deploy.sh`
- Phase 9: output of `curl -I https://api.itsviva.com/api/healthz`
- Phase 10: output of all three smoke checks
- Phase 11: any browser console / network errors from the dashboard
- Phase 12: anything weird the TestFlight testers report

I'll catch problems early and tell you what to do next.
