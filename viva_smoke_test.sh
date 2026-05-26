#!/usr/bin/env bash
# =============================================================
# Viva Pilot Smoke Test
# =============================================================
# WARNING: This script creates real database rows (patient invite,
# activation, check-in, interventions, care events). Run it only
# against staging or test data. If you run it against production,
# delete the test patient row from the doctor dashboard afterwards.
#
# BEFORE RUNNING — fill in the four variables below:
#
#   TEST_DOCTOR_EMAIL     Email of a test doctor with MFA already enrolled
#   TEST_DOCTOR_PASSWORD  That doctor's password
#   INTERNAL_API_KEY      The INTERNAL_API_KEY env var value on the server
#   TEST_PATIENT_PHONE    A +1 number not already in the DB
#                         (e.g. +15550009001)
#
#   MFA code is prompted interactively — have your authenticator app open.
#
# REQUIREMENTS: curl and jq must be installed.
# USAGE: bash viva_smoke_test.sh
# =============================================================

set -uo pipefail

# ---- CONFIGURATION (fill these in) --------------------------
BASE="https://api.itsviva.com/api"
TEST_DOCTOR_EMAIL="FILL_IN"
TEST_DOCTOR_PASSWORD="FILL_IN"
INTERNAL_API_KEY="FILL_IN"
TEST_PATIENT_PHONE="+15550009001"
# -------------------------------------------------------------

COOKIE_JAR="/tmp/viva_smoke_cookies_$$.txt"
PASS_COUNT=0
FAIL_COUNT=0
FAILED_STEPS=""

DOC_TOKEN=""
PAT_TOKEN=""
PATIENT_ID=""
INT_ID=""
INT2_ID=""

log()  { echo ""; echo "[$(date +%T)] $*"; }
pass() { echo "  v  PASS  $1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "  x  FAIL  $1"; FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_STEPS="${FAILED_STEPS}\n    - $1"; }
die()  { echo ""; echo "  x  FATAL: $1"; echo "  Stopping."; exit 1; }
mask() { local v="$1"; if [ -z "$v" ] || [ "$v" = "null" ]; then echo "(empty)"; else echo "${v:0:8}..."; fi; }

split_resp() {
  RESP_HTTP=$(echo "$1" | tail -1)
  RESP_BODY=$(echo "$1" | head -n -1)
}

# ---- Preflight ----------------------------------------------
echo ""
echo "============================================================"
echo " Viva Pilot Smoke Test -- $(date)"
echo " Base: $BASE"
echo "============================================================"

log "PREFLIGHT: Checking configuration"
[ "$TEST_DOCTOR_EMAIL"    = "FILL_IN" ] && die "TEST_DOCTOR_EMAIL not set"
[ "$TEST_DOCTOR_PASSWORD" = "FILL_IN" ] && die "TEST_DOCTOR_PASSWORD not set"
[ "$INTERNAL_API_KEY"     = "FILL_IN" ] && die "INTERNAL_API_KEY not set"
command -v curl >/dev/null 2>&1 || die "curl not found"
command -v jq   >/dev/null 2>&1 || die "jq not found"
pass "Configuration and dependencies OK"

# ---- Step 1: Doctor login -----------------------------------
log "STEP 1: Doctor login"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -c "$COOKIE_JAR" \
  -d "{\"email\":\"$TEST_DOCTOR_EMAIL\",\"password\":\"$TEST_DOCTOR_PASSWORD\"}")
split_resp "$RAW"
DOC_TOKEN=$(echo "$RESP_BODY" | jq -r '.token // empty')
if [ "$RESP_HTTP" = "200" ] && [ -n "$DOC_TOKEN" ]; then
  pass "Doctor login (HTTP $RESP_HTTP, token: $(mask "$DOC_TOKEN"))"
else
  fail "Doctor login (HTTP $RESP_HTTP)"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
  die "Cannot continue without doctor token"
fi

# ---- Step 2: MFA verify -------------------------------------
log "STEP 2: MFA verify"
echo "  Open your authenticator app and enter the current 6-digit code."
read -rp "  MFA code: " MFA_CODE
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/me/mfa/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DOC_TOKEN" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -d "{\"code\":\"$MFA_CODE\"}")
split_resp "$RAW"
MFA_OK=$(echo "$RESP_BODY" | jq -r '.ok // empty')
if [ "$RESP_HTTP" = "200" ] && [ "$MFA_OK" = "true" ]; then
  pass "MFA verified (HTTP $RESP_HTTP)"
else
  fail "MFA verify (HTTP $RESP_HTTP)"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
  die "Cannot continue without MFA -- PHI routes will return 403"
fi

# ---- Step 3: Create patient invite --------------------------
log "STEP 3: Create patient invite (phone: $TEST_PATIENT_PHONE)"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/patients/invite" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DOC_TOKEN" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -d "{\"name\":\"Smoke Test Patient\",\"phone\":\"$TEST_PATIENT_PHONE\"}")
split_resp "$RAW"
PATIENT_ID=$(echo "$RESP_BODY"  | jq -r '.patient.userId // .patient.id // .userId // .id // empty')
INVITE_LINK=$(echo "$RESP_BODY" | jq -r '.inviteLink // empty')
INVITE_TOKEN=$(echo "$INVITE_LINK" | awk -F'/' '{print $NF}')
if [ "$RESP_HTTP" = "201" ] && [ -n "$PATIENT_ID" ] && [ -n "$INVITE_TOKEN" ]; then
  pass "Patient invite created (HTTP $RESP_HTTP, patientId: $PATIENT_ID, token: $(mask "$INVITE_TOKEN"))"
else
  fail "Patient invite (HTTP $RESP_HTTP)"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
  die "Cannot continue without patient invite"
fi

# ---- Step 4: Patient activates ------------------------------
log "STEP 4: Patient activation"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/auth/activate" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$INVITE_TOKEN\",\"password\":\"SmokePat123!\"}")
split_resp "$RAW"
PAT_TOKEN=$(echo "$RESP_BODY"    | jq -r '.token // empty')
ACTIVATED_ID=$(echo "$RESP_BODY" | jq -r '.user.id // .id // empty')
if [ "$RESP_HTTP" = "200" ] && [ -n "$PAT_TOKEN" ]; then
  pass "Patient activated (HTTP $RESP_HTTP, userId: $ACTIVATED_ID, token: $(mask "$PAT_TOKEN"))"
else
  fail "Patient activation (HTTP $RESP_HTTP)"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
  die "Cannot continue without patient token"
fi

# ---- Step 5: Submit check-in --------------------------------
log "STEP 5: Submit check-in (nausea=moderate, appetite=low)"
TODAY=$(date +%Y-%m-%d)
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/me/checkins" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAT_TOKEN" \
  -d "{\"date\":\"$TODAY\",\"energy\":\"tired\",\"nausea\":\"moderate\",\"mood\":2,\"appetite\":\"low\",\"hydration\":\"low\",\"source\":\"manual_save\"}")
split_resp "$RAW"
CI_NAUSEA=$(echo "$RESP_BODY" | jq -r '.nausea // empty')
if [ "$RESP_HTTP" = "200" ] || [ "$RESP_HTTP" = "201" ]; then
  pass "Check-in submitted (HTTP $RESP_HTTP, nausea: $CI_NAUSEA)"
else
  fail "Check-in submission (HTTP $RESP_HTTP)"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
  die "Cannot generate intervention without a check-in"
fi

# ---- Step 6: Generate first intervention --------------------
log "STEP 6: Generate intervention"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/patient/interventions/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAT_TOKEN" \
  -d '{"source":"checkin"}')
split_resp "$RAW"
INT_ID=$(echo "$RESP_BODY"      | jq -r '.intervention.id // .id // empty')
INT_STATUS=$(echo "$RESP_BODY"  | jq -r '.intervention.status // .status // empty')
INT_TRIGGER=$(echo "$RESP_BODY" | jq -r '.intervention.triggerType // .triggerType // empty')
INT_GENBY=$(echo "$RESP_BODY"   | jq -r '.intervention.generatedBy // .generatedBy // empty')
INT_CONTEXT=$(echo "$RESP_BODY" | jq -r '.intervention.contextSummary // .contextSummary // "absent"')
if ([ "$RESP_HTTP" = "200" ] || [ "$RESP_HTTP" = "201" ]) && [ -n "$INT_ID" ] && [ "$INT_ID" != "null" ]; then
  pass "Intervention generated (HTTP $RESP_HTTP, id: $INT_ID, trigger: $INT_TRIGGER, status: $INT_STATUS, generatedBy: $INT_GENBY)"
  if [ "$INT_CONTEXT" != "absent" ] && [ "$INT_CONTEXT" != "null" ] && [ "$INT_CONTEXT" != "{}" ]; then
    fail "SECURITY: contextSummary present in patient-facing response (must be stripped)"
  else
    pass "contextSummary correctly absent from response"
  fi
else
  fail "Intervention generation (HTTP $RESP_HTTP)"
  echo "  Body: $(echo "$RESP_BODY" | jq -c '{reason:.reason, status:.intervention.status} // .' 2>/dev/null || echo "$RESP_BODY")"
  die "No intervention ID -- cannot continue lifecycle steps"
fi

# ---- Step 7: Verify active list -----------------------------
log "STEP 7: Verify GET /patient/interventions/active"
RAW=$(curl -s -w "\n%{http_code}" -X GET "$BASE/patient/interventions/active" \
  -H "Authorization: Bearer $PAT_TOKEN")
split_resp "$RAW"
ACTIVE_COUNT=$(echo "$RESP_BODY" | jq '.interventions | length // 0')
ACTIVE_STATUS=$(echo "$RESP_BODY" | jq -r '.interventions[0].status // empty')
if [ "$RESP_HTTP" = "200" ] && [ "${ACTIVE_COUNT:-0}" -ge 1 ]; then
  pass "Active intervention visible (count: $ACTIVE_COUNT, status: $ACTIVE_STATUS)"
else
  fail "Active interventions list (HTTP $RESP_HTTP, count: ${ACTIVE_COUNT:-0})"
fi

# ---- Step 8: Accept -----------------------------------------
log "STEP 8: Accept intervention (shown -> pending_feedback)"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/patient/interventions/$INT_ID/accept" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAT_TOKEN")
split_resp "$RAW"
ACCEPT_STATUS=$(echo "$RESP_BODY" | jq -r '.intervention.status // .status // empty')
if [ "$RESP_HTTP" = "200" ] && [ "$ACCEPT_STATUS" = "pending_feedback" ]; then
  pass "Intervention accepted (status: $ACCEPT_STATUS)"
else
  fail "Accept intervention (HTTP $RESP_HTTP, status: ${ACCEPT_STATUS:-?})"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
fi

# ---- Step 9: Better feedback --------------------------------
log "STEP 9: Submit better feedback (pending_feedback -> resolved)"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/patient/interventions/$INT_ID/feedback" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAT_TOKEN" \
  -d '{"feedbackResult":"better"}')
split_resp "$RAW"
FB_STATUS=$(echo "$RESP_BODY"    | jq -r '.intervention.status // .status // empty')
FB_RESULT=$(echo "$RESP_BODY"    | jq -r '.intervention.feedbackResult // .feedbackResult // empty')
FB_COLL=$(echo "$RESP_BODY"      | jq -r '.intervention.feedbackCollectedAt // .feedbackCollectedAt // empty')
FB_ESCALATED=$(echo "$RESP_BODY" | jq -r '.intervention.escalatedAt // .escalatedAt // empty')
if [ "$RESP_HTTP" = "200" ] && [ "$FB_STATUS" = "resolved" ]; then
  pass "Better feedback accepted (status: $FB_STATUS, feedbackResult: $FB_RESULT)"
  [ -n "$FB_COLL" ] && [ "$FB_COLL" != "null" ] \
    && pass "feedbackCollectedAt set" \
    || fail "feedbackCollectedAt not set on resolved row"
  ( [ -z "$FB_ESCALATED" ] || [ "$FB_ESCALATED" = "null" ] ) \
    && pass "escalatedAt correctly null on resolved path" \
    || fail "escalatedAt unexpectedly set on resolved path"
else
  fail "Better feedback (HTTP $RESP_HTTP, status: ${FB_STATUS:-?})"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
fi

# ---- Step 10: Pilot metrics -- better path ------------------
log "STEP 10: Pilot metrics check -- after better feedback"
METRICS_RAW=$(curl -s "$BASE/internal/analytics/summary" \
  -H "Authorization: Bearer $INTERNAL_API_KEY")
M_ENG_JOIN=$(echo "$METRICS_RAW"  | jq -r '.pilot.rules.engagementJoin // "N/A"')
M_VERSION=$(echo "$METRICS_RAW"   | jq -r '.pilot.metricDefinitionVersion // "not_in_response"')
M_TRIGGERED=$(echo "$METRICS_RAW" | jq -r '.pilot.interventions.triggered // "N/A"')
M_ENGAGED=$(echo "$METRICS_RAW"   | jq -r '.pilot.interventions.engaged // "N/A"')
M_AUTORES=$(echo "$METRICS_RAW"   | jq -r '.pilot.interventions.autoResolved // "N/A"')
M_ESCALATED=$(echo "$METRICS_RAW" | jq -r '.pilot.interventions.escalated // "N/A"')
M_PAT_ESC=$(echo "$METRICS_RAW"   | jq -r '.pilot.provider.patientsEscalated // "N/A"')

echo "  Metrics snapshot (better path):"
echo "    metricDefinitionVersion:    $M_VERSION"
echo "    engagementJoin:             $M_ENG_JOIN"
echo "    interventions.triggered:    $M_TRIGGERED"
echo "    interventions.engaged:      $M_ENGAGED"
echo "    interventions.autoResolved: $M_AUTORES"
echo "    interventions.escalated:    $M_ESCALATED"
echo "    provider.patientsEscalated: $M_PAT_ESC"

[ "$M_VERSION" = "v1.1.0" ] \
  && pass "metricDefinitionVersion = v1.1.0" \
  || fail "metricDefinitionVersion is '$M_VERSION' (expected v1.1.0 -- field may not be in this response)"
[ "$M_ENG_JOIN" = "exact_feedback_collected_at" ] \
  && pass "engagementJoin = exact_feedback_collected_at" \
  || fail "engagementJoin is '$M_ENG_JOIN' (expected exact_feedback_collected_at -- old build still live?)"
[ "${M_TRIGGERED}" != "N/A" ] && [ "${M_TRIGGERED}" -ge 1 ] 2>/dev/null \
  && pass "interventions.triggered >= 1 ($M_TRIGGERED)" \
  || fail "interventions.triggered is $M_TRIGGERED (expected >= 1)"
[ "${M_ENGAGED}" != "N/A" ] && [ "${M_ENGAGED}" -ge 1 ] 2>/dev/null \
  && pass "interventions.engaged >= 1 ($M_ENGAGED)" \
  || fail "interventions.engaged is $M_ENGAGED (expected >= 1)"
[ "${M_AUTORES}" != "N/A" ] && [ "${M_AUTORES}" -ge 1 ] 2>/dev/null \
  && pass "interventions.autoResolved >= 1 ($M_AUTORES)" \
  || fail "interventions.autoResolved is $M_AUTORES (expected >= 1)"

# ---- Step 11: Generate second intervention ------------------
log "STEP 11: Generate second intervention (escalation path)"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/patient/interventions/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAT_TOKEN" \
  -d '{"source":"checkin"}')
split_resp "$RAW"
INT2_ID=$(echo "$RESP_BODY"      | jq -r '.intervention.id // .id // empty')
INT2_STATUS=$(echo "$RESP_BODY"  | jq -r '.intervention.status // .status // empty')
INT2_TRIGGER=$(echo "$RESP_BODY" | jq -r '.intervention.triggerType // .triggerType // empty')
if ([ "$RESP_HTTP" = "200" ] || [ "$RESP_HTTP" = "201" ]) && [ -n "$INT2_ID" ] && [ "$INT2_ID" != "null" ]; then
  pass "Second intervention generated (HTTP $RESP_HTTP, id: $INT2_ID, trigger: $INT2_TRIGGER, status: $INT2_STATUS)"
else
  fail "Second intervention generation (HTTP $RESP_HTTP)"
  echo "  Body: $(echo "$RESP_BODY" | jq -c '{reason:.reason, status:.intervention.status} // .' 2>/dev/null || echo "$RESP_BODY")"
  die "Cannot run escalation path without second intervention"
fi

# ---- Step 12: Accept second intervention --------------------
log "STEP 12: Accept second intervention"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/patient/interventions/$INT2_ID/accept" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAT_TOKEN")
split_resp "$RAW"
ACC2_STATUS=$(echo "$RESP_BODY" | jq -r '.intervention.status // .status // empty')
if [ "$RESP_HTTP" = "200" ] && [ "$ACC2_STATUS" = "pending_feedback" ]; then
  pass "Second intervention accepted (status: $ACC2_STATUS)"
else
  fail "Accept second intervention (HTTP $RESP_HTTP, status: ${ACC2_STATUS:-?})"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
fi

# ---- Step 13: Worse feedback --------------------------------
log "STEP 13: Submit worse feedback (pending_feedback -> escalated)"
RAW=$(curl -s -w "\n%{http_code}" -X POST "$BASE/patient/interventions/$INT2_ID/feedback" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $PAT_TOKEN" \
  -d '{"feedbackResult":"worse"}')
split_resp "$RAW"
ESC_STATUS=$(echo "$RESP_BODY" | jq -r '.intervention.status // .status // empty')
ESC_AT=$(echo "$RESP_BODY"     | jq -r '.intervention.escalatedAt // .escalatedAt // empty')
ESC_COLL=$(echo "$RESP_BODY"   | jq -r '.intervention.feedbackCollectedAt // .feedbackCollectedAt // empty')
if [ "$RESP_HTTP" = "200" ] && [ "$ESC_STATUS" = "escalated" ]; then
  pass "Worse feedback accepted (status: $ESC_STATUS)"
  [ -n "$ESC_AT" ] && [ "$ESC_AT" != "null" ] \
    && pass "escalatedAt set" \
    || fail "escalatedAt not set after worse feedback"
  [ -n "$ESC_COLL" ] && [ "$ESC_COLL" != "null" ] \
    && pass "feedbackCollectedAt set on escalated path" \
    || fail "feedbackCollectedAt not set on escalated path"
else
  fail "Worse feedback (HTTP $RESP_HTTP, status: ${ESC_STATUS:-?})"
  echo "  Body: $(echo "$RESP_BODY" | jq -c . 2>/dev/null || echo "$RESP_BODY")"
fi

# ---- Step 14: Pilot metrics -- escalation path --------------
log "STEP 14: Pilot metrics check -- after worse feedback"
METRICS_RAW2=$(curl -s "$BASE/internal/analytics/summary" \
  -H "Authorization: Bearer $INTERNAL_API_KEY")
M2_TRIGGERED=$(echo "$METRICS_RAW2" | jq -r '.pilot.interventions.triggered // "N/A"')
M2_ENGAGED=$(echo "$METRICS_RAW2"   | jq -r '.pilot.interventions.engaged // "N/A"')
M2_ESCALATED=$(echo "$METRICS_RAW2" | jq -r '.pilot.interventions.escalated // "N/A"')
M2_AUTORES=$(echo "$METRICS_RAW2"   | jq -r '.pilot.interventions.autoResolved // "N/A"')
M2_PAT_ESC=$(echo "$METRICS_RAW2"   | jq -r '.pilot.provider.patientsEscalated // "N/A"')

echo "  Metrics snapshot (after escalation):"
echo "    interventions.triggered:    $M2_TRIGGERED"
echo "    interventions.engaged:      $M2_ENGAGED"
echo "    interventions.escalated:    $M2_ESCALATED"
echo "    interventions.autoResolved: $M2_AUTORES"
echo "    provider.patientsEscalated: $M2_PAT_ESC"

[ "${M2_TRIGGERED}" != "N/A" ] && [ "${M2_TRIGGERED}" -ge 2 ] 2>/dev/null \
  && pass "interventions.triggered >= 2 ($M2_TRIGGERED)" \
  || fail "interventions.triggered is $M2_TRIGGERED (expected >= 2)"
[ "${M2_ENGAGED}" != "N/A" ] && [ "${M2_ENGAGED}" -ge 2 ] 2>/dev/null \
  && pass "interventions.engaged >= 2 ($M2_ENGAGED)" \
  || fail "interventions.engaged is $M2_ENGAGED (expected >= 2)"
[ "${M2_ESCALATED}" != "N/A" ] && [ "${M2_ESCALATED}" -ge 1 ] 2>/dev/null \
  && pass "interventions.escalated >= 1 ($M2_ESCALATED)" \
  || fail "interventions.escalated is $M2_ESCALATED (expected >= 1)"
[ "${M2_PAT_ESC}" != "N/A" ] && [ "${M2_PAT_ESC}" -ge 1 ] 2>/dev/null \
  && pass "provider.patientsEscalated >= 1 ($M2_PAT_ESC)" \
  || fail "provider.patientsEscalated is $M2_PAT_ESC (expected >= 1)"

# ---- Cleanup + final report ---------------------------------
rm -f "$COOKIE_JAR"
echo ""
echo "============================================================"
echo " SMOKE TEST COMPLETE -- $(date)"
echo "============================================================"
echo "  PASSED: $PASS_COUNT"
echo "  FAILED: $FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo "  Failed steps:"
  printf "%b\n" "$FAILED_STEPS"
  echo ""
  echo "  STATUS: NEEDS ATTENTION"
else
  echo ""
  echo "  STATUS: ALL CHECKS PASSED -- pilot readout is functional"
fi
echo ""
echo "  Test patient userId:  $PATIENT_ID"
echo "  Intervention 1 id:    $INT_ID  (resolved via better feedback)"
echo "  Intervention 2 id:    $INT2_ID (escalated via worse feedback)"
echo ""
echo "  NOTE: If metricDefinitionVersion showed 'not_in_response',"
echo "  the field is not currently exposed in the summary API response."
echo "  Use engagementJoin = exact_feedback_collected_at as the"
echo "  definitive indicator that v1.1.0 code is running."
echo ""
echo "  ACTION: Delete the test patient row before going live."
echo "============================================================"
