# Platform ops runbook

This runbook covers all operator tasks for the Viva multi-tenant platform system:
creating platforms, assigning doctors, and running the platform backfill.

All write operations use the internal API, which requires `INTERNAL_API_KEY`.
All read operations on `/api/internal/metrics` also require it.

---

## Prerequisites

- `INTERNAL_API_KEY` — the shared bearer token set in the server's env.
- `BASE_URL` — the API server root, e.g. `https://api.itsviva.com`.
- For the backfill script: SSH or SSM access to the server with `DATABASE_URL` in env.

---

## 1. Create a platform

Each Viva customer (e.g. "Ola Health") needs a platform row before any of
their doctors can be onboarded.

```bash
curl -X POST "$BASE_URL/api/internal/platforms" \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Ola Health", "slug": "ola-health"}'
```

**`slug`** must be URL-safe lowercase (letters, digits, hyphens).
It is permanent — do not change it after creation.

**Success (201):**
```json
{ "id": 3, "name": "Ola Health", "slug": "ola-health", "status": "active" }
```

**Conflict (409):** slug already exists — check the existing platform ID and reuse it.

---

## 2. Assign a doctor to a platform

A doctor account must already exist (created by the doctor signing up, or seeded).
Run this once per doctor per platform onboarding.

```bash
curl -X POST "$BASE_URL/api/internal/platforms/3/doctors" \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"doctorId": 12}'
```

Replace `3` with the platform ID from step 1 and `12` with the doctor's user ID.

**Success (200):**
```json
{
  "doctor": { "id": 12, "name": "Dr. Jane Smith", "email": "jane@olahealth.com",
              "role": "doctor", "platformId": 3 },
  "platform": { "id": 3, "name": "Ola Health" },
  "warning": "Doctor platform updated. Existing patient rows for this doctor
              retain their previous platformId. Run the backfill script
              (pnpm --filter @workspace/api-server run backfill) to align them."
}
```

> **Important:** reassigning a doctor does **not** cascade to their existing
> patients. Run the backfill (section 4) after any doctor platform change.

---

## 3. Full customer #2 onboarding sequence

This is the end-to-end flow for a new customer after the doctor account exists.

### Step 1 — Create the platform
```bash
curl -X POST "$BASE_URL/api/internal/platforms" \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Ola Health", "slug": "ola-health"}'
# Note the returned "id" — use it in the next step.
```

### Step 2 — Assign the doctor
```bash
curl -X POST "$BASE_URL/api/internal/platforms/<platform-id>/doctors" \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"doctorId": <doctor-user-id>}'
```

### Step 3 — Doctor sends patient invite
The doctor logs in and sends an invite through the app UI (or `POST /patients/invite`).
The patient row is stamped with `platformId = doctor.platformId` at invite creation time.

### Step 4 — Patient activates
Patient clicks the activation link, sets a password (`POST /auth/activate`).
Their `platformId` and `doctorId` are preserved unchanged — the activation route
does not accept or modify them.

### Step 5 — Verify platform-scoped metrics
```bash
curl "$BASE_URL/api/internal/metrics?platformSlug=ola-health" \
  -H "Authorization: Bearer $INTERNAL_API_KEY"
```

Expected response shape:
```json
{
  "scope": "platform",
  "platformId": 3,
  "platformSlug": "ola-health",
  "platformName": "Ola Health",
  "invitesSent": 1,
  "activatedPatients": 1,
  ...
}
```

The patient appears only under `ola-health`, not under other platforms.
A global query (`/metrics` with no filter) continues to aggregate all platforms.

---

## 4. Backfill null-platform rows

The backfill script fixes legacy doctor and patient rows where `platformId IS NULL`.
This applies to rows created before platform support was added, or in environments
where the demo platform row was absent at signup time.

### Dry run first (always)

```bash
pnpm --filter @workspace/api-server run backfill -- --dry-run
```

Sample output:
```
[backfill] DRY RUN — no writes will be made.
[backfill] Demo platform: "Demo Platform" (id=1)

[backfill] Doctors with platformId=null: 3
[backfill]   Would update 3 doctor row(s) → platform_id=1
[backfill] Patients with platformId=null: 17
[backfill]   Would update ~17 patient row(s) from doctor platform_id

[backfill] Final null counts:
  Doctors  with platformId=null: 3
  Patients with platformId=null: 17

[backfill] Dry run complete. Re-run without --dry-run to apply changes.
```

### Live run — demo / staging

```bash
pnpm --filter @workspace/api-server run backfill
```

### Live run — production (explicit opt-in required)

```bash
ALLOW_BACKFILL=true pnpm --filter @workspace/api-server run backfill
```

The script blocks on production unless `ALLOW_BACKFILL=true` is set.
Always review the dry-run output before setting this.

### What the backfill does

1. Find the demo platform by `slug='demo'`. Exits if not found — run seed first.
2. Set `users.platform_id = demo.id` for every doctor with `platform_id IS NULL`.
3. Copy `platform_id` from each doctor to their patients where `patients.platform_id IS NULL`.
   Patients whose doctor still has no platform are left null and reported in the final count.
4. Print final null counts.

---

## 5. Query platform-scoped metrics

```bash
# By platform ID:
curl "$BASE_URL/api/internal/metrics?platformId=3" \
  -H "Authorization: Bearer $INTERNAL_API_KEY"

# By slug (case-insensitive):
curl "$BASE_URL/api/internal/metrics?platformSlug=ola-health" \
  -H "Authorization: Bearer $INTERNAL_API_KEY"

# Global (all platforms, demo users excluded):
curl "$BASE_URL/api/internal/metrics" \
  -H "Authorization: Bearer $INTERNAL_API_KEY"
```

The response includes a `scope` field (`"global"` or `"platform"`) plus
`platformId`, `platformSlug`, `platformName` so the caller can confirm
which scope was applied.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503 platform_unavailable` at doctor signup | Demo platform row missing | Run `pnpm --filter @workspace/api-server run seed` |
| `404 platform_not_found` on metrics call | Wrong ID or slug | Check via the create-platform response or DB |
| `warn: invite_created_with_null_platform_id` in logs | Doctor signed up before demo platform existed | Run backfill |
| Backfill exits: "Demo platform row not found" | Seed not run | `pnpm --filter @workspace/api-server run seed` then retry |
| Patient not appearing under platform metrics | Patient invited before doctor was assigned | Run backfill after assigning doctor |
