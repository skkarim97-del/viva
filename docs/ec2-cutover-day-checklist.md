# EC2 cutover-day checklist (api.itsviva.com)

**Read this entire doc before changing a single value.** Nothing here
should be touched until Phase 10 of `ec2-cutover-runbook.md` has passed
green and `https://api.itsviva.com/api/healthz` returns 200 from the
public internet.

The Replit deployment at `viva-ai.replit.app` keeps running for the
entire bake-in window. Both backends share the same RDS database, so
which front-end calls which is purely a routing question — there is no
data divergence.

---

## Section 1 — Pre-cutover gate (must all be GREEN before flipping anything)

| Check | Command | Expected |
|------|---------|----------|
| EC2 public health | `curl -sS https://api.itsviva.com/api/healthz` | `{"status":"ok"}` |
| EC2 TLS valid | `echo \| openssl s_client -connect api.itsviva.com:443 -servername api.itsviva.com 2>/dev/null \| openssl x509 -noout -issuer -dates` | issuer `Let's Encrypt`, dates current |
| EC2 well-known iOS | `curl -sS https://api.itsviva.com/.well-known/apple-app-site-association \| head` | JSON with `applinks.details[].appIDs` |
| EC2 well-known Android | `curl -sS https://api.itsviva.com/.well-known/assetlinks.json \| head` | JSON array with `package_name` |
| Replit health (must still work) | `curl -sS https://viva-ai.replit.app/api/healthz` | `{"status":"ok"}` |
| Operator-route IP allowlist works | from an allowed IP: `curl -H "Authorization: Bearer $OPERATOR_KEY" https://api.itsviva.com/api/internal/healthz` | 200; from a disallowed IP, 403 |
| EC2 logs show no errors | `sudo journalctl -u viva-api -n 200 --no-pager` on box | no ERROR lines |
| Backups confirmed | RDS automated backups enabled, retention >= 7 days | confirmed in RDS console |

If any row is RED, **stop**. Do not proceed.

---

## Section 2 — Complete file inventory (current value -> new value)

This is every place in the repo where a hostname lives. Sorted by **risk**:
config-only changes first, then mobile binary changes (slowest to roll
back).

### Tier A — server-side only, instant rollback (env-var redeploys)

| File / Setting | Current value | New value | Rollback |
|---|---|---|---|
| `artifacts/viva-dashboard/.replit-artifact/artifact.toml` line 33 `API_ORIGIN` | `https://viva-ai.replit.app` | `https://api.itsviva.com` | revert env, redeploy (~60s) |
| EC2 systemd unit `/etc/viva/viva-api.env` `ALLOWED_ORIGINS` | (only the dashboard origin in use at the time) | comma-separated list of every active dashboard origin during bake-in | edit env, `sudo systemctl restart viva-api` |

### Tier B — server-side comments / fallbacks (no behavior change today)

These only matter if a request arrives without a `Host` header (which
should never happen in practice). Update them in the same PR as the
mobile change so the codebase stays consistent.

| File | Current | New |
|---|---|---|
| `artifacts/api-server/src/routes/patients.ts` line 554 `const host = req.get("host") \|\| "viva-ai.replit.app"` | viva-ai.replit.app | `api.itsviva.com` |
| `artifacts/api-server/src/routes/invite.ts` line 11 (comment only) | viva-ai.replit.app | `api.itsviva.com` |
| `artifacts/api-server/src/app.ts` line 47 (CORS comment example) | dashboard.viva-ai.com | `clinic.itsviva.com` (or whatever the final dashboard origin is) |

### Tier C — mobile binary (requires new TestFlight / Play build, ~1 day per platform)

This is the slowest leg. Do this **only** after Tier A has been live for
at least 48 hours with no error spike.

| File | Current | New |
|---|---|---|
| `artifacts/pulse-pilot/lib/apiConfig.ts` line 7 `PRODUCTION_API_URL` | `https://viva-ai.replit.app/api` | `https://api.itsviva.com/api` |
| `artifacts/pulse-pilot/app.json` `ios.associatedDomains` | `["applinks:viva-ai.replit.app"]` | `["applinks:api.itsviva.com", "applinks:viva-ai.replit.app"]` -- keep BOTH for one release so old TestFlight links still open the app |
| `artifacts/pulse-pilot/app.json` `android.intentFilters[0].data[0].host` | `viva-ai.replit.app` | duplicate the data block: keep one with `viva-ai.replit.app`, add a second with `api.itsviva.com` |
| `artifacts/pulse-pilot/app.json` `ios.buildNumber` | `42` | bump to `43` |
| `artifacts/pulse-pilot/app.json` `android.versionCode` | `2` | bump to `3` |
| `artifacts/pulse-pilot/app/connect.tsx` line 159 placeholder | `https://viva-ai.replit.app/invite/...` | `https://api.itsviva.com/invite/...` (cosmetic) |
| `artifacts/pulse-pilot/app/_layout.tsx` line 109 (comment) | viva-ai.replit.app | `api.itsviva.com` (cosmetic) |

After the new build is in TestFlight + internal Play track:
1. Run an internal pilot device through enroll -> invite -> coach end
   to end against the new build.
2. Wait for at least 24 hours of error-free production telemetry from
   the new build before promoting to App Store / Play production.

---

## Section 3 — Cutover-day step sequence (what to do, in order)

> Each step has its own rollback. Do not skip ahead.

**Step 1 — Add EC2 origin to its own CORS list.** On the EC2 box, set
`ALLOWED_ORIGINS=https://viva-ai.replit.app` (already done at install).
This is the *current* dashboard origin. Restart `viva-api`.
*Rollback:* none needed, this is a no-op for users (no dashboard yet
hits this backend).

**Step 2 — Smoke-test the dashboard manually against EC2.** From your
laptop, in a private browser window, override the dashboard's API base
locally:
```bash
# from artifacts/viva-dashboard/
VITE_API_BASE_URL=https://api.itsviva.com/api pnpm dev
```
Sign in, view a patient, send a structured coach message, run a care
event review. Watch EC2 logs in another terminal:
```bash
sudo journalctl -u viva-api -f
```
Every request should land cleanly. *Rollback:* close the dev server.
Production untouched.

**Step 3 — Flip the dashboard's API origin (Tier A change #1).**
Edit `artifacts/viva-dashboard/.replit-artifact/artifact.toml` line 33:
```toml
API_ORIGIN = "https://api.itsviva.com"
```
Commit, push, and trigger a Replit redeploy of the dashboard artifact.
The dashboard URL doesn't change; only its server-side proxy target
does. *Rollback:* revert that one line, redeploy. ~60 seconds.

**Step 4 — Watch for 1 hour.** Dashboard error rate (Replit logs) and
EC2 error rate (`journalctl -u viva-api -f`) should both be flat. If
either spikes, run the rollback in Step 3.

**Step 5 — Bake for 48 hours.** No further changes. Mobile is still
hitting Replit, so any client bug only affects the dashboard, which is
internal-only.

**Step 6 — Build and submit the new mobile binary (Tier C).** Apply
all Tier C edits in one commit. Build with EAS, submit to TestFlight
(iOS) and internal track (Play). Have a teammate install it and run
through the doctor onboarding + a real-looking patient invite flow.
*Rollback:* don't promote the build past internal testing.

**Step 7 — Promote mobile to production.** After 24 hours of clean
internal-track telemetry, promote in App Store Connect / Play Console.
*Rollback:* the previous build (`buildNumber: 42`) stays in the store
until you remove it -- you cannot reach back to phones that already
auto-updated, but the previous Replit backend is still online and
serving any user who hasn't updated yet. Keep Replit alive for at
least 14 days after the new build hits production.

**Step 8 — Apply Tier B comment/fallback updates.** Cosmetic, no
production impact. Can be done any time after Step 7.

**Step 9 — Decommission.** After 30 days of clean production
telemetry on the new mobile build, you can stop the Replit deployment.
Do **not** delete it -- pause it so it can be restarted in seconds if a
forensic question comes up.

---

## Section 4 — What about invite links, deep links, and Apple universal links?

You explicitly asked. Here is exactly what changes.

**Invite links** are constructed in `routes/patients.ts:550-556`:
```ts
function buildInviteLink(req, token) {
  const host = req.get("host") || "viva-ai.replit.app";
  return `${proto}://${host}/invite/${token}`;
}
```
The host comes from the `Host` header of the request that created the
invite. So:

- While the dashboard hits Replit -> invites are
  `https://viva-ai.replit.app/invite/<token>`.
- After Step 3 (dashboard flipped to EC2) -> new invites are
  `https://api.itsviva.com/invite/<token>`.
- **Old invite links keep working** as long as Replit stays online --
  they hit Replit's `/invite/:token` HTML page, which is the same
  code, same DB, same outcome.

**iOS Universal Links** auto-open the Viva app *only* when the URL
host appears in `app.json` `ios.associatedDomains` AND the matching
domain serves a valid `/.well-known/apple-app-site-association` file
that contains the app's team ID + bundle ID.

Today only `viva-ai.replit.app` is in the iOS allowlist. After Step 3,
new invite URLs use `api.itsviva.com`, which is **not** in the iOS
allowlist of any installed build yet -- so on iOS those links open in
Safari, the patient sees the HTML landing page, taps the "Open in
Viva" button, and is sent to TestFlight / App Store. **The flow still
works**, but the silky one-tap "open the installed app" experience is
lost for the brief window between Step 3 and the new mobile build
hitting users (Step 7).

This is why the runbook keeps both domains in `associatedDomains` for
the first new mobile build -- so old TestFlight invite links also
still open the new app.

**Android App Links** behave identically: `intentFilters[].data.host`
must list the URL host. We add `api.itsviva.com` as a *second* data
block alongside the existing `viva-ai.replit.app` one in the same
mobile build for the same reason.

**Dashboard routing** is independent of any of this. The dashboard is
served from `viva-ai.replit.app` (path `/`) and proxies its `/api/*`
calls to whatever `API_ORIGIN` env var is set to in
`viva-dashboard/.replit-artifact/artifact.toml`. Step 3 changes the
proxy target only; the URL the doctor sees in their browser does not
change.

If you eventually want a branded dashboard URL too (e.g.
`clinic.itsviva.com`), that's a *separate* DNS + Squarespace + Replit
custom-domain task that does not depend on this cutover.

---

## Section 5 — Post-cutover sanity (run weekly during bake-in)

```bash
# From your laptop:
curl -sS https://api.itsviva.com/api/healthz
curl -sS https://viva-ai.replit.app/api/healthz   # must still be 200

# Compare PHI access logs across both backends to spot drift:
psql "$AWS_DATABASE_URL" -c \
  "select count(*) filter (where created_at > now() - interval '24 hours'),
          count(distinct user_id) filter (where created_at > now() - interval '24 hours')
   from phi_access_logs;"
```

If the daily PHI access count drops to zero on either backend that
should be receiving traffic, something is misrouted -- investigate
before the next 24-hour window closes.
