# Viva PHI Pilot Cutover Runbook

Move the PHI-handling API off Replit, onto AWS App Runner, and into a
small controlled real-PHI pilot. Lean but not reckless: every item in
"Must-do" is here because skipping it materially changes safety,
reliability, or your ability to recover from a problem.

---

## Three buckets, in order

### Bucket 1 — Must-do before the real-PHI pilot

These are the launch gates. If any one of them is unchecked, do not
start the pilot.

- [ ] api-server image built (Dockerfile in `artifacts/api-server/`).
- [ ] Image pushed to ECR (`viva-api:latest` + dated tag).
- [ ] App Runner service `viva-api-prod` running, health green.
- [ ] All required env vars set (see `.env.prod.template`); secrets in
      Secrets Manager, not pasted into the env panel.
- [ ] Zero AI keys (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
      `GEMINI_API_KEY`) anywhere in the App Runner config.
- [ ] `ENABLE_DEV_LOGIN` and `ALLOW_DEMO_SEED` are unset in production.
- [ ] `COACH_PILOT_MODE=safe` and `INTERVENTION_AI_MODE=fallback` set
      explicitly (defaults already safe; explicit value is auditable).
- [ ] RDS public access OFF, encryption ON, backups >=7d, deletion
      protection ON.
- [ ] RDS security group inbound 5432 allows ONLY the App Runner SG.
      No `0.0.0.0/0`, no Replit IPs, no leftover home-IP rules.
- [ ] Demo data wiped from production RDS
      (`DELETE FROM users WHERE email LIKE 'demo%@itsviva.com' OR ...`).
      Snapshot before/after counts saved to a file.
- [ ] `api.itsviva.com` DNS now points to the App Runner host. TTL
      lowered to 60s before the cutover.
- [ ] `https://api.itsviva.com/api/healthz` returns 200 from outside AWS.
- [ ] PHI audit logs writing: a real authenticated request increments
      `select count(*) from phi_access_logs where created_at > now() -
      interval '5 minutes'`.
- [ ] Pino log redaction verified: tail App Runner logs during a real
      request and confirm no `email`, `phone`, `message`, `body`, or
      bearer token appears in plaintext.
- [ ] Clinic/patient access scoped: as doctor A,
      `GET /api/patients/<doctor-B-patient-id>` returns 404. Each pilot
      doctor is the sole `patients.doctorId` for their patients
      (1-doctor-per-patient model is what `canAccessPatient` enforces).
- [ ] Smoke-test checklist (§Smoke tests below) all green.
- [ ] Replit api-server deployment **stopped** after 24h of healthy
      App Runner traffic.
- [ ] Rollback plan rehearsed once: you know how to flip the DNS CNAME
      back to the previous host in <2 minutes.

### Bucket 2 — Smart but not required before pilot

Worth doing in the first 30 days of the pilot. Don't block launch on these.

- Move `viva-dashboard` and `viva-analytics` static bundles to S3 +
  CloudFront. Cleaner BAA posture; no PHI in the bundles, but the
  doctor's authenticated session renders PHI and S3/CloudFront are
  BAA-covered.
- CloudWatch alarms: 5xx rate > 1%, healthz failures, PHI access volume
  per doctor anomaly, RDS CPU > 70%.
- Automated image build + push on `main` (GitHub Actions → ECR → App
  Runner auto-deploy).
- Independent penetration test scoped to the doctor + patient APIs.
- Shared-clinic access model (covering doctor / care team) — only if
  a pilot clinic asks for it.
- A staging App Runner service that points at a staging RDS, so you
  can rehearse releases instead of pushing straight to prod.

### Bucket 3 — Defer until after pilot traction

These are real engineering investments. Don't start them before you
have evidence the product works.

- Multi-tenant org model.
- AI personalization that touches PHI (would require BAA-eligible LLM
  tier + fresh threat model + audit).
- Major architecture refactor (event bus, microservices, etc.).
- Formal SOC 2 type 1/2 process.
- Cross-region failover, blue/green deploys, infra-as-code conversion
  of the App Runner stack.

---

## Answers to your clarifying questions

**1. Can we safely skip the local Docker smoke test and test directly on
App Runner?**
Yes. Local Docker mainly catches Dockerfile typos. App Runner's first
deploy will fail in the same way and tell you in the Logs tab. If you
want to skip local Docker entirely, that is fine — go straight from
`docker build + push` to App Runner and read the logs there. Trade-off:
each App Runner deploy is ~5 min, so an iteration loop on a Dockerfile
bug is slower than local. **Recommendation: skip local Docker only if
you don't have Docker Desktop installed and don't want to install it.**

**2. Can this be done from Replit Shell, or do I need Windows
PowerShell?**
Replit Shell can do everything except the local Docker test (Replit
doesn't run Docker for you). So:
- **Replit Shell** is enough if you skip the local Docker step. You
  install AWS CLI in the shell, build the image inside Replit using
  `docker buildx` is NOT available — so build on AWS instead via
  CodeBuild, OR push your code to a small EC2 build host, OR use App
  Runner's "source code repository" mode. **Cleanest lean path: use
  App Runner's source-code mode and skip Docker entirely** (see
  variant below).
- **Windows PowerShell + Docker Desktop** is the standard path if you
  already have Docker Desktop. Faster iteration, identical result.

**Lean variant: App Runner source-code mode (no Docker on your laptop)**
App Runner can build directly from a GitHub repo. You push the
`Dockerfile` to a branch, point App Runner at the repo, and it does
the build for you. Cost is the same; you skip Docker Desktop entirely.
This is probably the right path for a one-person controlled pilot.

**3. What is the minimum local setup required?**
- AWS account with billing enabled, an IAM user with App Runner +
  ECR + Secrets Manager + IAM permissions, and AWS CLI configured.
- Admin access to the DNS provider hosting `itsviva.com`.
- A `psql` client (or DBeaver / TablePlus) to run the demo-wipe SQL
  against RDS. You can also run SQL through the RDS Query Editor in
  the AWS Console, no local install needed.
- Optional: Docker Desktop (only if you choose the local-build path).

**4. Lean path that avoids unnecessary cost but keeps confidence high?**
- App Runner: 1 vCPU / 2 GB, min instances = 1, max = 3. ~$45/mo.
- RDS: `db.t4g.small`, `Single-AZ`, 20 GB, automated backups 7d.
  ~$30/mo. **Single-AZ is fine for a controlled pilot** — the BAA
  doesn't require Multi-AZ; downtime risk is bounded by your pilot
  size, not regulatory.
- Secrets Manager: 2 secrets × $0.40 = ~$1/mo.
- ECR: < $1/mo for a small repo.
- CloudWatch logs: < $5/mo at pilot volume.
- **Total: roughly $80/mo of AWS spend** for the pilot footprint.
  Replit autoscale charges go to ~$0 once you stop the api-server
  deployment.

The single highest-leverage cost-saver: keep `viva-dashboard` and
`viva-analytics` on Replit static hosting until after the pilot. The
PHI exposure is in the API only; the static bundles render PHI in the
browser but never store it. Move them to S3/CloudFront in the first 30
days post-launch.

---

## Step-by-step execution

Pick **one** of two paths.

### Path A — Lean, no local Docker (recommended for one operator)

Use App Runner's source-code mode. App Runner pulls from your GitHub
repo, builds the Dockerfile in AWS, deploys. You never run Docker on
your laptop.

1. **Push the repo to GitHub** if it isn't already. The `Dockerfile`
   at `artifacts/api-server/Dockerfile` is what App Runner builds.
2. **AWS Console → App Runner → Create service**:
   - Source: **Source code repository** → connect to GitHub → pick the
     repo and the `main` branch.
   - Deployment trigger: **Manual** (flip to Automatic after pilot).
   - Build settings: **Configure all settings here** → Runtime:
     **Docker** → Dockerfile path: `artifacts/api-server/Dockerfile` →
     Docker build context: `/` (repo root).
3. Continue from **Step 4 (RDS lockdown)** below — everything from
   that point is identical between paths.

### Path B — Local Docker build (if you have Docker Desktop)

1. **PowerShell**, in the repo root:
   ```powershell
   docker build -f artifacts/api-server/Dockerfile -t viva-api:latest .
   ```
2. **(Optional) Local smoke test:**
   ```powershell
   $secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
   docker run --rm -p 8080:8080 `
     -e NODE_ENV=production -e PORT=8080 -e SESSION_SECRET=$secret `
     -e AWS_DATABASE_URL="postgres://...rds...?sslmode=require" `
     viva-api:latest
   # in another shell:
   curl.exe -s http://127.0.0.1:8080/api/healthz
   ```
3. **Push to ECR:**
   ```powershell
   $AccountId = "<aws-account-id>"
   $Region    = "us-east-1"
   $Repo      = "viva-api"
   $Tag       = (Get-Date -Format "yyyyMMdd-HHmm")
   $EcrUri    = "$AccountId.dkr.ecr.$Region.amazonaws.com/$Repo"

   aws ecr create-repository --repository-name $Repo --region $Region
   aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"
   docker tag viva-api:latest "${EcrUri}:${Tag}"
   docker tag viva-api:latest "${EcrUri}:latest"
   docker push "${EcrUri}:${Tag}"
   docker push "${EcrUri}:latest"
   ```
4. **App Runner → Create service** → **Container registry → Amazon ECR**
   → pick `viva-api:latest`. Then continue with Step 4.

---

### Step 4 — Lock RDS down (both paths)

**RDS Console → your DB instance → Modify**:
- Public accessibility = **No**
- Storage encryption = **Enabled**
- Backup retention = **7 days**
- Deletion protection = **Enabled**

**RDS Console → Connectivity & security → VPC security group**:
- Remove every inbound rule except the one App Runner will use.
- Note the VPC ID and the two private subnets the RDS lives in.

### Step 5 — Store secrets

**Secrets Manager → Store a new secret → Other type**:
- `viva/prod/AWS_DATABASE_URL` = your full `postgres://...?sslmode=require` string
- `viva/prod/SESSION_SECRET` = `openssl rand -hex 32` output

### Step 6 — App Runner service config

Use `artifacts/api-server/.env.prod.template` as the source of truth.
Plain values pasted directly; secrets via Secrets Manager ARN
references.

- Service name: `viva-api-prod`, 1 vCPU, 2 GB, port 8080.
- Health check: HTTP `/api/healthz`, 20s, healthy 1, unhealthy 3.
- Networking → Outgoing: Custom VPC, RDS's VPC + private subnets, new
  SG `viva-apprunner-sg` (allow all outbound, no inbound).
- Env vars: every REQUIRED var from the template. **No** AI keys, **no**
  `ENABLE_DEV_LOGIN`, **no** `ALLOW_DEMO_SEED`, **no** `DATABASE_URL`.

Click Create. Wait 5–10 min for **Running**. App Runner gives you a URL
like `https://abc123xyz.us-east-1.awsapprunner.com`.

### Step 7 — Wire RDS to App Runner

**RDS security group → Inbound → Add rule**: PostgreSQL / 5432 / Source
= `viva-apprunner-sg`. Save. Remove every other inbound rule.

Test:
```bash
curl -s https://abc123xyz.us-east-1.awsapprunner.com/api/healthz
# expect: 200 OK
```

If 5xx: App Runner Console → Logs. The most common failure is the
startup assert firing — the log line `production safety assert failed`
lists exactly which env var to fix.

### Step 8 — DNS cutover

In your DNS provider:
1. Lower the TTL on the existing `api.itsviva.com` record to **60s**.
   Wait the old TTL out (5 min – 1 hr).
2. App Runner → service → Custom domains → Link `api.itsviva.com`. Add
   the validation CNAMEs it shows you.
3. Wait until App Runner status = **Active** with cert issued.
4. Change the `api.itsviva.com` record to a CNAME pointing at the App
   Runner URL. Save.
5. From outside AWS: `curl -s https://api.itsviva.com/api/healthz`
   should return 200.

### Step 9 — Wipe demo data from production RDS

Use `psql` or the RDS Query Editor in the AWS Console.
```sql
BEGIN;
SELECT 'users_before' AS k, count(*) FROM users
UNION ALL SELECT 'patients_before', count(*) FROM patients
UNION ALL SELECT 'checkins_before', count(*) FROM patient_checkins;

DELETE FROM users
WHERE email LIKE 'demo%@itsviva.com'
   OR email LIKE '%@vivaai.demo'
   OR email LIKE '%@invite.viva.local';

SELECT 'users_after' AS k, count(*) FROM users
UNION ALL SELECT 'patients_after', count(*) FROM patients
UNION ALL SELECT 'checkins_after', count(*) FROM patient_checkins;

-- If the after counts look right:
COMMIT;
-- otherwise:
-- ROLLBACK;
```

If FKs to `users.id` aren't `ON DELETE CASCADE`, delete from
`patient_checkins` and `patients` first within the same transaction.

### Step 10 — Decommission Replit

Wait 24h after the DNS cutover. Then:
- Replit Console → Deployments → stop the api-server deployment.
- Confirm nothing PHI-bearing still points at Replit:
  ```bash
  rg -n "replit\.app|REPLIT_DOMAINS" artifacts/pulse-pilot artifacts/viva-dashboard
  ```
  Output should be empty or non-PHI references only.

---

## Smoke tests (launch / no-launch gate)

All must pass before flipping the pilot on. Run from outside AWS.

```bash
# 1. Health
curl -sf https://api.itsviva.com/api/healthz   # 200

# 2. Dev routes blocked
curl -i https://api.itsviva.com/api/dev/login   # 404

# 3. Coach safe-mode active (need a real bearer)
curl -i -X POST https://api.itsviva.com/api/coach/chat \
  -H "Authorization: Bearer <patient-token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"hi"}'   # 403 with safeMode:true

# 4. Demo data gone
psql "$AWS_DATABASE_URL" -c "select count(*) from users where email like 'demo%@itsviva.com';"   # 0

# 5. Cross-clinic access blocked
# As doctor A's session, GET /api/patients/<doctor-B-patient-id>      # 404 (not 403, not the row)

# 6. PHI audit logs writing
# After hitting any patient endpoint:
psql "$AWS_DATABASE_URL" -c "select count(*) from phi_access_logs where created_at > now() - interval '5 minutes';"   # > 0

# 7. Demo seed blocked in production
NODE_ENV=production pnpm --filter @workspace/api-server run seed   # exits 1 with "refusing to run"

# 8. Demo invites blocked in production
# As a demo-pattern doctor, POST /api/patients/invite  # 403 demo_invites_blocked_in_production

# 9. Startup assert works (do once, then revert)
# Add OPENAI_API_KEY=test in App Runner env, redeploy.
# Logs should show: "production safety assert failed" and the service should NOT go healthy.
# Remove the env var and redeploy.
```

## Rollback

If anything regresses post-cutover:
1. DNS provider → flip `api.itsviva.com` CNAME back to the previous
   host. ~1 minute to propagate (TTL=60).
2. Stop the App Runner service to halt billing.
3. RDS data is unchanged — no migration was performed.

---

## Final recommendation: when are you safe to start with real patients?

You are safe to start the controlled real-PHI pilot the moment:

1. Every Bucket 1 box is checked.
2. Every smoke test in the section above is green.
3. The pilot telehealth platform's BAA is signed.
4. You have a written plan for what to do if a patient reports a safety
   concern (who answers, in what time window, escalation path).

Item 4 is the only non-AWS gate left. It is a one-page document, not an
engineering project, but the pilot should not start without it.

Start with the smallest cohort the partner clinic will accept — ideally
10–25 patients for the first 2 weeks — then expand toward 200 once you
have signal that the operational runbook (alerts, on-call, audit log
review) actually works at low volume. This is the lowest-regret path:
real-PHI exposure is bounded, you keep all the safety properties the
code already enforces, and you don't pay for infra or process you don't
yet need.
