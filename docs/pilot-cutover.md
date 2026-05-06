# Viva PHI Pilot Cutover Runbook

Move the PHI-handling API off Replit, onto **AWS Elastic Beanstalk
(Docker, single-instance)**, and into a small controlled real-PHI
pilot. Lean but not reckless: every item in "Must-do" is here because
skipping it materially changes safety, reliability, or your ability to
recover from a problem.

> **Why Elastic Beanstalk and not App Runner?** App Runner stopped
> accepting new customers on April 30, 2026. Beanstalk is the
> simplest remaining HIPAA-eligible AWS path that can build our
> Dockerfile in-environment (no local Docker, no ECR push step,
> no CodeBuild project). Same Dockerfile, same RDS, same DNS plan,
> same env vars, same startup assert.

---

## Three buckets, in order

### Bucket 1 — Must-do before the real-PHI pilot

These are the launch gates. If any one of them is unchecked, do not
start the pilot.

- [ ] Root `Dockerfile` and `.dockerignore` present (mirrors
      `artifacts/api-server/Dockerfile`; required by Beanstalk's
      Docker platform).
- [ ] Beanstalk environment `viva-api-prod` running, health = Ok,
      single-instance (no load balancer).
- [ ] All required env vars set (see `.env.prod.template`); secrets in
      Secrets Manager, **referenced** from Beanstalk env via the
      `aws:elasticbeanstalk:application:environment` namespace, not
      pasted as plaintext.
- [ ] Zero AI keys (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
      `GEMINI_API_KEY`) anywhere in the Beanstalk environment config.
- [ ] `ENABLE_DEV_LOGIN` and `ALLOW_DEMO_SEED` are unset in production.
- [ ] `COACH_PILOT_MODE=safe` and `INTERVENTION_AI_MODE=fallback` set
      explicitly (defaults already safe; explicit value is auditable).
- [ ] RDS public access OFF, encryption ON, backups >=7d, deletion
      protection ON.
- [ ] RDS security group inbound 5432 allows ONLY the Beanstalk EC2
      instance SG (`awseb-e-*-stack-AWSEBSecurityGroup-*`). No
      `0.0.0.0/0`, no Replit IPs, no leftover home-IP rules.
- [ ] Demo data wiped from production RDS
      (`DELETE FROM users WHERE email LIKE 'demo%@itsviva.com' OR ...`).
      Snapshot before/after counts saved to a file.
- [ ] `api.itsviva.com` DNS now points to the Beanstalk environment
      CNAME. TTL lowered to 60s before the cutover.
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
      Beanstalk traffic.
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
- Automated source-bundle deploy on push to `main` (GitHub Actions →
  upload zip to S3 → `aws elasticbeanstalk create-application-version`
  → `update-environment`).
- Independent penetration test scoped to the doctor + patient APIs.
- Shared-clinic access model (covering doctor / care team) — only if
  a pilot clinic asks for it.
- A staging Beanstalk environment that points at a staging RDS, so you
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
  of the Beanstalk stack (or migration to ECS Fargate when scale
  requires it).

---

## Operational notes

**No local Docker required.** Beanstalk's Docker platform builds the
root `Dockerfile` inside the EC2 instance it provisions for you. You
upload a source bundle (a zip of the repo) and Beanstalk handles
`docker build` and `docker run`. If the Dockerfile has a bug, you see
it in the Beanstalk environment logs and fix it in the next upload.

**Minimum setup required.**
- AWS account with billing enabled and an IAM user with Beanstalk +
  EC2 + RDS + Secrets Manager + IAM permissions.
- Admin access to the DNS provider hosting `itsviva.com`.
- A `psql` client (or DBeaver / TablePlus) for the demo-wipe SQL
  against RDS — or use the RDS Query Editor in the AWS Console.

**Cost (single-instance, pilot footprint).**
- Beanstalk EC2: `t4g.small`, single instance (no ELB). ~$15/mo.
- RDS: `db.t4g.small`, Single-AZ, 20 GB, backups 7d. ~$30/mo.
  Single-AZ is fine for a controlled pilot; the BAA doesn't require
  Multi-AZ.
- Secrets Manager: 2 secrets × $0.40 = ~$1/mo.
- CloudWatch logs: < $5/mo at pilot volume.
- **Total: roughly $50/mo of AWS spend.** Cheaper than the App Runner
  estimate because no load balancer.

The single highest-leverage cost-saver: keep `viva-dashboard` and
`viva-analytics` on Replit static hosting until after the pilot. The
PHI exposure is in the API only; the static bundles render PHI in the
browser but never store it. Move them to S3/CloudFront in the first 30
days post-launch.

---

## Step-by-step execution

### Step 1 — Prepare the source bundle

The repo already contains a root `Dockerfile` and `.dockerignore` (so
Beanstalk's Docker platform can build without configuration).

Two ways to get the bundle to Beanstalk; pick whichever you prefer:

- **Easiest:** GitHub → repo → green **Code** button → **Download ZIP**.
  This produces `viva-main.zip` containing the full repo.
- **CLI:** in Replit Shell, `git archive --format=zip --output=viva-main.zip HEAD`.

Either way, the zip you upload must contain `Dockerfile` at its root.

### Step 2 — Create the Beanstalk application + environment

**AWS Console → Elastic Beanstalk → Create application.**

- Application name: `viva`
- Platform: **Docker** (running on 64-bit Amazon Linux 2023)
- Application code: **Upload your code** → upload the zip from Step 1
- Presets: **Single instance (free tier eligible)**
- Click **Next**.

Service access:

- Service role: **Create and use new service role** (`aws-elasticbeanstalk-service-role`)
- EC2 instance profile: **Create and use new** (`aws-elasticbeanstalk-ec2-role`)
- EC2 key pair: optional (skip for pilot; not needed if you only need EB Console + Logs).

Networking:

- VPC: **the same VPC your RDS instance lives in.**
- Public IP address: **Activated** (single-instance environments need a public IP to receive direct traffic; the EC2 SG will be locked down to HTTPS-from-anywhere only).
- Instance subnets: pick **one public subnet** (single instance).

Database: **Do not** attach an RDS instance here. Your existing RDS
stays separate so it survives environment rebuilds.

Instance traffic and scaling:

- Root volume: 10 GB gp3 (default)
- Instance type: `t4g.small`
- Environment type: **Single instance** (already chosen by the preset)

Updates, monitoring, and logging:

- Health reporting: **Enhanced**
- CloudWatch Logs: **Enabled**, retention **7 days**, **Lifecycle: Delete logs upon environment termination = No** (so logs survive a rebuild).

Environment properties (env vars): paste every REQUIRED var from
`artifacts/api-server/.env.prod.template`. **No** AI keys, **no**
`ENABLE_DEV_LOGIN`, **no** `ALLOW_DEMO_SEED`, **no** `DATABASE_URL`.
For `AWS_DATABASE_URL` and `SESSION_SECRET`, leave a placeholder for
now — Step 4 swaps them for Secrets Manager references.

Click **Submit**. Beanstalk takes ~5–10 min to provision EC2, build
the Docker image in the instance, and start the container. When the
environment health turns **Ok** (green), continue.

### Step 3 — Lock RDS down

**RDS Console → your DB instance → Modify**:
- Public accessibility = **No**
- Storage encryption = **Enabled**
- Backup retention = **7 days**
- Deletion protection = **Enabled**

**RDS Console → Connectivity & security → VPC security group**:
- Note the VPC ID. Confirm it matches the VPC you chose for Beanstalk.
- Leave the inbound rule edit until Step 5 (we need the Beanstalk EC2
  SG name first).

### Step 4 — Store secrets and reference them from Beanstalk

**Secrets Manager → Store a new secret → Other type**:
- `viva/prod/AWS_DATABASE_URL` = your full `postgres://...?sslmode=require` string
- `viva/prod/SESSION_SECRET` = `openssl rand -hex 32` output

**Grant the Beanstalk EC2 role access:** IAM → Roles →
`aws-elasticbeanstalk-ec2-role` → Add permissions → Create inline
policy → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": [
      "arn:aws:secretsmanager:<region>:<account-id>:secret:viva/prod/AWS_DATABASE_URL-*",
      "arn:aws:secretsmanager:<region>:<account-id>:secret:viva/prod/SESSION_SECRET-*"
    ]
  }]
}
```

Beanstalk environments do **not** natively interpolate Secrets Manager
ARNs in env vars (unlike App Runner). Two acceptable options:

- **Option A (simplest, pilot-acceptable):** paste the secret values
  directly into the Beanstalk environment properties panel. They are
  stored encrypted at rest by Beanstalk and only visible to IAM
  principals with `elasticbeanstalk:DescribeConfigurationSettings`.
  Lock that down to your operator IAM user.
- **Option B (stronger):** add a small `.platform/hooks/prebuild/`
  shell script that fetches the secrets via `aws secretsmanager
  get-secret-value` and writes them to `/opt/elasticbeanstalk/deploy/
  configuration/containerenvironment` before Docker starts. Defer to
  post-pilot unless your compliance reviewer asks for it.

Pick Option A for pilot. Update the `AWS_DATABASE_URL` and
`SESSION_SECRET` env values in **Beanstalk → Configuration → Updates,
monitoring, and logging → Environment properties → Edit**.

### Step 5 — Wire RDS to the Beanstalk instance

**EC2 Console → Security groups** → find the SG named
`awseb-e-<env-id>-stack-AWSEBSecurityGroup-<random>` (created by
Beanstalk). Copy its SG ID.

**RDS Console → your DB → Connectivity & security → VPC security
groups → the one attached → Inbound → Edit:**
- Add rule: PostgreSQL / 5432 / Source = the Beanstalk EC2 SG ID above.
- **Remove every other inbound rule** (no `0.0.0.0/0`, no Replit IPs,
  no home IPs).

Beanstalk gives the environment a CNAME like
`viva-api-prod.eba-abc123.us-east-1.elasticbeanstalk.com`. Test:
```bash
curl -s http://viva-api-prod.eba-abc123.us-east-1.elasticbeanstalk.com/api/healthz
# expect: 200 OK
```

If 5xx: Beanstalk → Environment → Logs → Request Logs → Last 100
lines. The most common failure is the startup assert firing — the log
line `production safety assert failed` lists exactly which env var to
fix. Update env props, Apply, wait for the rolling restart.

### Step 6 — DNS cutover (HTTPS via ACM)

Beanstalk single-instance environments serve HTTP only by default
because there is no load balancer to terminate TLS. For HTTPS to
`api.itsviva.com`, terminate TLS at the EC2 instance using a
Beanstalk `.platform/nginx/conf.d` snippet + ACM certificate, **or**
put a small CloudFront distribution in front (recommended — no nginx
config to maintain, ACM cert at the edge, free tier covers pilot
volume).

Recommended (CloudFront in front of Beanstalk):

1. ACM (us-east-1) → Request public certificate for `api.itsviva.com`
   → DNS validation → add the CNAME at your DNS provider → wait for
   "Issued".
2. CloudFront → Create distribution:
   - Origin domain: the Beanstalk environment CNAME
   - Origin protocol: HTTP only
   - Viewer protocol policy: Redirect HTTP to HTTPS
   - Allowed methods: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
   - Cache policy: **CachingDisabled** (this is an API)
   - Origin request policy: **AllViewerExceptHostHeader**
   - Alternate domain name (CNAME): `api.itsviva.com`
   - Custom SSL certificate: pick the ACM cert
3. Lower TTL on existing `api.itsviva.com` to **60s**, wait the old
   TTL out.
4. Change `api.itsviva.com` to a CNAME pointing at the CloudFront
   distribution domain (`d123abc.cloudfront.net`).
5. From outside AWS: `curl -s https://api.itsviva.com/api/healthz`
   returns 200.

(Single-instance HTTPS without CloudFront is documented in the
Beanstalk Docker reference if you prefer; it adds ~30 lines of nginx
config + a cert renewal script. Not worth it for pilot.)

### Step 7 — Wipe demo data from production RDS

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

### Step 8 — Decommission Replit

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
2. Beanstalk → Environment → Actions → **Terminate environment** to
   halt billing. (Application stays; you can recreate the environment
   from the same source bundle.)
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
