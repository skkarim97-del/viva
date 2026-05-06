# Viva PHI Pilot Cutover Runbook

Move PHI-handling compute off Replit and onto AWS (App Runner) before the
controlled real-PHI pilot. Everything below is the **minimum** needed.

---

## 0. Environment separation (the rule)

| Environment | DB | Demo data | Who runs seed |
|---|---|---|---|
| **Production** (real pilot) | AWS RDS (BAA) | **Never** | Nobody |
| **Demo** (Viva Clinic showcase) | Separate RDS or local Postgres | demo@itsviva.com + 12 patients | Operator with `ALLOW_DEMO_SEED=true` |
| **Local dev** | Local Postgres | Anything | Anyone |

Code-level guardrails already in place after this cutover:

- `artifacts/api-server/src/index.ts` -- startup assert refuses to boot
  in production if any AI key, `ENABLE_DEV_LOGIN`, weak `SESSION_SECRET`,
  or missing `AWS_DATABASE_URL`.
- `artifacts/api-server/scripts/seed.ts` and
  `scripts/src/seedSyntheticPilot.ts` -- refuse to run when
  `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` (intended only for
  the demo DB).
- `artifacts/api-server/src/routes/patients.ts` -- demo-doctor invites
  return 403 in production, so demo identities can never inject rows
  into the real pilot patient table.
- `artifacts/api-server/src/lib/demoFilter.ts` -- analytics still
  excludes `demo%@itsviva.com` server-side as a backup; primary defense
  is environment separation.

---

## 1. Build the API image

From repo root:

```bash
docker build -f artifacts/api-server/Dockerfile -t viva-api:latest .
docker run --rm -p 8080:8080 \
  -e NODE_ENV=production \
  -e PORT=8080 \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e AWS_DATABASE_URL="postgres://...staging-rds...?sslmode=require" \
  viva-api:latest
# in another shell:
curl -sf http://127.0.0.1:8080/api/healthz
```

If healthz returns 200, image is good.

---

## 2. Push to ECR

```bash
AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO=viva-api

aws ecr create-repository --repository-name "$REPO" --region "$AWS_REGION" || true
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker tag viva-api:latest "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:$(date +%Y%m%d-%H%M)"
docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO:$(date +%Y%m%d-%H%M)"
```

---

## 3. Create the App Runner service

Console -> App Runner -> Create service.

- **Source**: ECR -> the image you just pushed.
- **Deployment**: Manual (auto on later if you want).
- **Service settings**:
  - Port: `8080`
  - CPU: 1 vCPU, Memory: 2 GB (downsize after pilot baseline if idle).
  - Health check: HTTP `/api/healthz`, interval 20s, healthy 1, unhealthy 3.
- **Networking -> Outbound**: "Custom VPC" -> select the VPC + private
  subnets that can reach RDS. Attach a security group whose **outbound
  443 + 5432** is allowed.

---

## 4. Set environment variables (App Runner -> Configuration -> Env)

Required:

```
NODE_ENV=production
PORT=8080
AWS_DATABASE_URL=postgres://<user>:<pass>@<rds-endpoint>:5432/<db>?sslmode=require
SESSION_SECRET=<openssl rand -hex 32>
COACH_PILOT_MODE=safe
INTERVENTION_AI_MODE=fallback
OPERATOR_ALLOWED_IPS=<office/VPN egress IPs, comma-separated>
LOG_LEVEL=info
```

**Must be absent** (the startup assert will refuse to boot if any of these is set):

```
ENABLE_DEV_LOGIN
OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY
ALLOW_DEMO_SEED        # never on production
DATABASE_URL           # forces use of AWS_DATABASE_URL only
```

Store `SESSION_SECRET` and `AWS_DATABASE_URL` in **AWS Secrets Manager**
and reference them from App Runner; do not paste them into the env panel.

---

## 5. Connect to RDS

- RDS instance must be in the **same VPC** as App Runner's VPC connector.
- RDS security group inbound: allow `5432` **only** from the App Runner
  VPC connector's security group. **Revoke** any inbound rule that
  references Replit egress IPs / `0.0.0.0/0`.
- RDS settings: `Encryption at rest = on`, `Backup retention = 7d`,
  `Public accessibility = no`, `Deletion protection = on`.

Verify after boot:

```bash
# from a bastion or psql session in the VPC
psql "$AWS_DATABASE_URL" -c "select count(*) from users;"
```

---

## 6. Wipe demo data from production RDS

Run **once**, against the prod RDS, before the pilot opens. CASCADE
removes downstream PHI rows (patients, checkins, plan items, etc.) tied
to the deleted users.

```sql
BEGIN;

-- Snapshot before
SELECT 'users_before' AS k, count(*) FROM users
UNION ALL SELECT 'patients_before', count(*) FROM patients
UNION ALL SELECT 'checkins_before', count(*) FROM patient_checkins;

-- Delete every demo user. FK cascades clean up patient/checkin/plan rows.
DELETE FROM users
WHERE email LIKE 'demo%@itsviva.com'
   OR email LIKE '%@vivaai.demo'
   OR email LIKE '%@invite.viva.local';

-- Snapshot after
SELECT 'users_after' AS k, count(*) FROM users
UNION ALL SELECT 'patients_after', count(*) FROM patients
UNION ALL SELECT 'checkins_after', count(*) FROM patient_checkins;

-- Eyeball the after counts. If they look right:
COMMIT;
-- otherwise:
-- ROLLBACK;
```

If the schema does not have `ON DELETE CASCADE` on every PHI FK to
`users.id`, run these explicitly first inside the same transaction:

```sql
DELETE FROM patient_checkins WHERE patient_user_id IN
  (SELECT id FROM users WHERE email LIKE 'demo%@itsviva.com' OR email LIKE '%@vivaai.demo');
DELETE FROM patients WHERE user_id IN
  (SELECT id FROM users WHERE email LIKE 'demo%@itsviva.com' OR email LIKE '%@vivaai.demo');
-- repeat for any other PHI table whose FK is RESTRICT/NO ACTION
```

---

## 7. Cut DNS over to App Runner

1. App Runner -> service -> Custom domains -> add `api.itsviva.com`.
2. Add the CNAME records App Runner displays at your DNS provider.
3. Wait for "Active" + cert issued (5-30 min).
4. From outside AWS:
   ```bash
   curl -sf https://api.itsviva.com/api/healthz
   ```
5. Hit a real PHI route from the doctor dashboard / mobile app and
   confirm 200 + correct response.

---

## 8. Decommission the Replit api-server path

After 24h of healthy traffic on App Runner:

- Replit -> Deployments -> stop the api-server deployment.
- In `.replit`, remove `[[artifacts]] id = "artifacts/api-server"` from
  the deployment block (or leave the artifact for local dev only and
  delete just the production deployment).
- Confirm there is no `*.replit.app` host in any remaining env:
  ```bash
  rg -n "replit\.app|REPLIT_DOMAINS" artifacts/pulse-pilot artifacts/viva-dashboard
  ```
  Mobile + dashboard should resolve all PHI traffic to `api.itsviva.com`
  only.

---

## 9. Pre-pilot smoke test (run from outside AWS)

Each item must pass before flipping the pilot on.

- [ ] **Healthz**: `curl -sf https://api.itsviva.com/api/healthz` -> 200.
- [ ] **Dev routes return 404**:
      `curl -i https://api.itsviva.com/api/dev/login` -> 404.
- [ ] **Coach free-text returns 403 / safe mode**:
      authenticated `POST /api/coach/chat` -> 403 with
      `{ safeMode: true, structuredEndpoint: "/coach/structured" }`.
- [ ] **Demo users excluded from analytics**: `SELECT count(*) FROM
      users WHERE email LIKE 'demo%@itsviva.com'` returns `0` on prod
      RDS; operator `/api/internal/metrics` returns the same patient
      count whether or not demo accounts ever existed.
- [ ] **Clinic/patient access scoped**: as doctor A,
      `GET /api/patients/<doctor-B-patient-id>` returns 404 (not 403,
      not the row).
- [ ] **PHI audit logs writing**: after any patient read,
      `SELECT count(*) FROM phi_access_logs WHERE created_at > now() -
      interval '5 minutes'` increases.
- [ ] **No AI keys in production**: App Runner config panel shows none
      of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`. A
      restart with any of them set must refuse to boot (the assert
      logs `production safety assert failed`).
- [ ] **DB points to AWS only**: in App Runner env, `AWS_DATABASE_URL`
      is set, `DATABASE_URL` is unset, RDS SG inbound is restricted to
      App Runner SG.
- [ ] **Demo seed blocked in production**: running
      `pnpm --filter @workspace/api-server run seed` against prod env
      exits non-zero with the "refusing to run" message.
- [ ] **Demo invites blocked in production**: a demo-pattern doctor
      hitting `POST /api/patients/invite` returns 403
      `demo_invites_blocked_in_production`.

If every box is ticked, you are clear for the controlled pilot.

---

## Rollback

If anything regresses post-cutover:

1. Re-point `api.itsviva.com` DNS back to the previous host (low TTL
   helps -- set TTL=60 before cutover).
2. Stop the App Runner service (it stops billing + serving immediately).
3. RDS data is unchanged; no migration was performed during cutover.
