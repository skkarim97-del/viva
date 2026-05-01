# EC2 smoke test (api.itsviva.com)

Runs end-to-end against the **live EC2 backend** using only routes that
already exist in the API. Replit and EC2 share the same RDS database,
so any account you already use in dev is valid here.

**Setup once (on your laptop):**

```bash
export API=https://api.itsviva.com/api
export PUB=https://api.itsviva.com
export COOKIES=/tmp/viva-ec2-cookies.txt
rm -f "$COOKIES"
# Optional, if you want to compute TOTP codes from the CLI rather than
# the authenticator app on your phone (saves a lot of tab-switching):
#   brew install oath-toolkit            # macOS
#   sudo apt-get install oathtool        # Debian/Ubuntu
```

Replace `<TEST_DOCTOR_EMAIL>` / `<TEST_DOCTOR_PASSWORD>` /
`<TEST_DOCTOR_TOTP_SECRET>` with values for an existing doctor account
that you've already MFA-enrolled in dev. If you don't have one, run a
fresh signup at the bottom of this doc first.

Each step prints PASS / FAIL on the right of every command. **Do not
skip a step**; ordering matters because patient activation depends on
an invite token from the previous doctor step.

---

## 1. Anonymous endpoints (no cookies, no auth)

| # | Command | Pass when |
|---|---|---|
| 1.1 | `curl -sS -o /dev/null -w "%{http_code}\n" $API/healthz` | `200` |
| 1.2 | `curl -sS $API/healthz` | `{"status":"ok"}` |
| 1.3 | `curl -sS -o /dev/null -w "%{http_code}\n" $PUB/.well-known/apple-app-site-association` | `200` if `APPLE_TEAM_ID` is set, else `404` |
| 1.4 | `curl -sS $PUB/.well-known/apple-app-site-association \| python3 -m json.tool \| head -10` | valid JSON with `appIDs: ["<TEAMID>.com.sullyk97.vivaai"]` |
| 1.5 | `curl -sS -o /dev/null -w "%{http_code}\n" $PUB/.well-known/assetlinks.json` | `200` if `ANDROID_APP_SIGNING_SHA256` is set, else `404` |
| 1.6 | `curl -sS $API/coach/mode` | `{"mode":"safe", "categories":[...], "severities":[...]}` |
| 1.7 | TLS chain: `echo \| openssl s_client -connect api.itsviva.com:443 -servername api.itsviva.com 2>/dev/null \| openssl x509 -noout -issuer -dates` | issuer `Let's Encrypt`, dates current |

If 1.3 / 1.5 return 404, that's expected when the env vars are unset
but it means iOS Universal Links and Android App Links won't auto-open
the app for invite URLs hitting EC2. Fix BEFORE the mobile cutover
(see "Pre-cutover prep" below).

---

## 2. Doctor login + MFA gate

```bash
# 2.1 Login (writes session cookie)
curl -sS -c "$COOKIES" -b "$COOKIES" \
  -H "Content-Type: application/json" \
  -d '{"email":"<TEST_DOCTOR_EMAIL>","password":"<TEST_DOCTOR_PASSWORD>"}' \
  $API/auth/login
# PASS: {"user":{"id":...,"role":"doctor", ...}}
```

```bash
# 2.2 PHI gate before MFA -- MUST be 403 mfa_required:verify
curl -sS -o /dev/null -w "%{http_code}\n" -b "$COOKIES" $API/patients
# PASS: 403
curl -sS -b "$COOKIES" $API/patients
# PASS body: {"error":"mfa_required:verify"}
```

```bash
# 2.3 Generate TOTP code (skip if using your phone's authenticator)
TOTP=$(oathtool --totp -b "<TEST_DOCTOR_TOTP_SECRET>")
echo "$TOTP"

# 2.4 MFA verify (flips session.mfaVerified = true)
curl -sS -c "$COOKIES" -b "$COOKIES" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$TOTP\"}" \
  $API/me/mfa/verify
# PASS: {"ok":true}

# 2.5 Same call as 2.2, now should be 200
curl -sS -o /dev/null -w "%{http_code}\n" -b "$COOKIES" $API/patients
# PASS: 200
```

```bash
# 2.6 MFA status sanity
curl -sS -b "$COOKIES" $API/me/mfa/status
# PASS: {"enrolled":true,"verified":true}
```

If 2.2 returns 200 instead of 403, MFA is not gating PHI -- **stop and
investigate** before any cutover.

---

## 3. Patient invite (writes a row + returns the invite URL)

```bash
# 3.1 Invite a fake patient
curl -sS -b "$COOKIES" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test Patient","phone":"+15555550199","glp1Drug":"Semaglutide","dose":"0.25mg weekly"}' \
  $API/patients/invite
# PASS shape: {"patient":{...,"activationToken":"<TOKEN>"},"inviteLink":"https://api.itsviva.com/invite/<TOKEN>"}
# Capture the token:
INVITE_TOKEN="<paste TOKEN from inviteLink>"
```

Things to check in the response:

- `inviteLink` host is **`api.itsviva.com`** (not `viva-ai.replit.app`)
  -- proves the host inheritance from the inbound request works.
- `inviteLink` opens in a browser and serves the HTML landing page
  (try it). Tap-to-open-app on iOS only works once `APPLE_TEAM_ID` is
  set AND a mobile build with `api.itsviva.com` in `associatedDomains`
  is installed, but the web fallback works today.

```bash
# 3.2 Public invite preview
curl -sS $API/invite/$INVITE_TOKEN
# PASS shape: {"name":"Smoke Test Patient","activated":false}

# 3.3 Doctor sees the new patient in their list
curl -sS -b "$COOKIES" $API/patients | python3 -c \
  'import json,sys; rows=json.load(sys.stdin); print(any(r["name"]=="Smoke Test Patient" for r in rows))'
# PASS: True
```

---

## 4. Patient activation (claims the account, returns a bearer)

```bash
# 4.1 Activate -- patient sets a password
curl -sS \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$INVITE_TOKEN\",\"password\":\"smoke-test-password-1234\"}" \
  $API/auth/activate
# PASS shape: {"bearer":"<RAW_TOKEN>","user":{"id":...,"role":"patient",...}}
# Capture the bearer:
PT_BEARER="<paste RAW_TOKEN from response>"

# 4.2 Replay the same token -- should fail (single-use)
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$INVITE_TOKEN\",\"password\":\"smoke-test-password-1234\"}" \
  $API/auth/activate
# PASS: 404 or 410 (NOT 200)
```

---

## 5. Patient check-in + care event + intervention

```bash
# 5.1 Today's check-in (creates patient_checkins row)
curl -sS \
  -H "Authorization: Bearer $PT_BEARER" \
  -H "Content-Type: application/json" \
  -d '{"appetite":"good","digestion":"comfortable","hydration":"hydrated","bowelMovement":true,"doseTakenToday":true}' \
  $API/me/checkins
# PASS shape: {"id":..., "date":"YYYY-MM-DD"}

# 5.2 Recent check-ins
curl -sS -H "Authorization: Bearer $PT_BEARER" $API/me/checkins
# PASS: array length >= 1

# 5.3 Patient self-creates a care event (e.g. nausea report)
curl -sS \
  -H "Authorization: Bearer $PT_BEARER" \
  -H "Content-Type: application/json" \
  -d '{"category":"side_effects","severity":"moderate","note":"smoke test event"}' \
  $API/care-events
# PASS shape: {"id":...,"category":"side_effects","severity":"moderate"}

# 5.4 Intervention log entry
curl -sS \
  -H "Authorization: Bearer $PT_BEARER" \
  -H "Content-Type: application/json" \
  -d '{"interventionType":"hydration","title":"Drank extra water","rationale":"smoke test"}' \
  $API/interventions/log
# PASS shape: {"id":...,"interventionType":"hydration"}
```

---

## 6. Doctor sees the patient's data

```bash
# 6.1 Find the patient's user id from step 3
PT_ID=$(curl -sS -b "$COOKIES" $API/patients | python3 -c \
  'import json,sys; rows=json.load(sys.stdin); print([r["userId"] for r in rows if r["name"]=="Smoke Test Patient"][0])')
echo "PT_ID=$PT_ID"

# 6.2 Patient detail (PHI read -> writes a phi_access_logs row)
curl -sS -o /dev/null -w "%{http_code}\n" -b "$COOKIES" $API/patients/$PT_ID
# PASS: 200

# 6.3 Care events list for this patient
curl -sS -b "$COOKIES" $API/care-events/$PT_ID
# PASS: array containing the event from 5.3

# 6.4 Recent interventions across the doctor's panel
curl -sS -b "$COOKIES" "$API/interventions/recent?limit=10"
# PASS: array containing the intervention from 5.4

# 6.5 Doctor marks the care event reviewed
EV_ID=$(curl -sS -b "$COOKIES" $API/care-events/$PT_ID | python3 -c \
  'import json,sys; print(json.load(sys.stdin)[0]["id"])')
curl -sS -b "$COOKIES" \
  -H "Content-Type: application/json" \
  -d "{\"careEventId\":$EV_ID}" \
  $API/care-events/reviewed
# PASS: {"ok":true}
```

---

## 7. Pilot metrics / analytics

```bash
# 7.1 Operator metrics (requires INTERNAL_API_KEY + IP allowlist)
#   Use the same value you put in /etc/viva-api.env; run from an IP
#   that's listed in INTERNAL_IP_ALLOWLIST.
curl -sS -H "Authorization: Bearer <INTERNAL_API_KEY>" \
  $API/internal/metrics
# PASS shape: {"invitesSent":N,"activated":N,"checkedInLast7":N,"checkinsLast7Total":N,...}

# 7.2 IP allowlist negative test -- run from a NON-allowed IP (e.g. mobile hotspot)
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer <INTERNAL_API_KEY>" \
  $API/internal/metrics
# PASS: 403

# 7.3 Bad key
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer not-a-real-key" \
  $API/internal/metrics
# PASS: 401
```

---

## 8. PHI access audit log (verify rows are being written)

Run from a machine that can reach RDS (the EC2 box itself is easiest):

```bash
# 8.1 Recent rows
psql "$AWS_DATABASE_URL" -c "
  select id, actor_role, action, target_patient_id,
         to_char(created_at, 'YYYY-MM-DD HH24:MI:SS TZ') as created_at
  from phi_access_logs
  order by created_at desc
  limit 10;
"
# PASS: at least one row from the last few minutes whose target_patient_id
# matches the patient you created in step 3, action mentions 'patients/:id'
# or similar, actor_role = 'doctor'.

# 8.2 No raw IPs / UAs leaked
psql "$AWS_DATABASE_URL" -c "
  select id, length(ip_hash) as ip_len, length(user_agent_hash) as ua_len
  from phi_access_logs
  order by created_at desc
  limit 5;
"
# PASS: ip_len = 64 and ua_len = 64 on every row (sha256 hex), not a
# raw IP string and not NULL on PHI requests.

# 8.3 Operator-bearer audit (actorUserId NULL, actorRole='operator')
psql "$AWS_DATABASE_URL" -c "
  select count(*) from phi_access_logs
  where actor_role = 'operator' and created_at > now() - interval '1 hour';
"
# PASS: >= 1 (your /internal/metrics call from step 7.1 should be logged)
```

---

## 9. Cleanup

```bash
# Remove the smoke-test patient + their data so the dashboard doesn't
# show "Smoke Test Patient" in pilot demos.
psql "$AWS_DATABASE_URL" <<SQL
delete from interventions where patient_user_id = $PT_ID;
delete from care_events     where patient_user_id = $PT_ID;
delete from patient_checkins where patient_user_id = $PT_ID;
delete from patients        where user_id = $PT_ID;
delete from users           where id = $PT_ID;
SQL
# Note: phi_access_logs rows are NOT deleted (append-only by design).
```

---

## 10. Pass/fail roll-up

You're green to proceed to the dashboard cutover step (Step 3 of
`ec2-cutover-day-checklist.md`) only when **every** check above
passes. If any fail, paste the failing command + output back to chat.

---

## Appendix — fresh doctor signup if you don't have a test account

```bash
# (One-time) create a fresh doctor in RDS via the public signup route
curl -sS -c "$COOKIES" -b "$COOKIES" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test Doctor","email":"smoketest+ec2@itsviva.com","password":"smoke-test-doctor-1234"}' \
  $API/auth/signup
# Then enroll TOTP via /me/mfa/enroll/start + /me/mfa/enroll/verify.
# Save the recovery codes that come back from /enroll/verify.
```
