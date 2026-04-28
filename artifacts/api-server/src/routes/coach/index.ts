import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db,
  apiTokensTable,
  coachMessagesTable,
  careEventsTable,
} from "@workspace/db";

const router = Router();

// Best-effort bearer-token resolver for the coach routes. The /chat
// route is intentionally not gated behind requirePatient (preserves
// the existing public-by-default behavior for legacy clients), but
// when the mobile app sends an Authorization header we want to
// associate persistence rows with the right patient. Returns null on
// any failure -- never throws -- so the chat path stays resilient.
async function resolvePatientUserId(req: Request): Promise<number | null> {
  try {
    const header = req.get("authorization") || "";
    const m = /^Bearer\s+([A-Za-z0-9_\-]+)$/.exec(header);
    if (!m) return null;
    const [row] = await db
      .select({
        userId: apiTokensTable.userId,
        role: apiTokensTable.role,
      })
      .from(apiTokensTable)
      .where(eq(apiTokensTable.token, m[1]!))
      .limit(1);
    if (!row || row.role !== "patient") return null;
    return row.userId;
  } catch {
    return null;
  }
}

// Heuristic detection of "I'm thinking about stopping / pausing /
// quitting / skipping treatment". Word-boundary matched so we don't
// flag normal sentences ("I had to stop the car"); we require a
// treatment / med / dose / shot anchor nearby. This is intentionally
// conservative -- a false negative is fine (the patient can also use
// the explicit Request review button), but a false positive spams the
// clinician's needs-review queue.
const STOP_VERB_RE = /\b(stop|stopping|stopped|pause|pausing|paused|skip|skipping|skipped|quit|quitting|quitted|discontinu\w*|come\s+off|coming\s+off|get\s+off|getting\s+off|going\s+off|stop\s+taking|hold\s+off)\b/i;
const TREATMENT_ANCHOR_RE = /\b(treatment|medication|med|meds|drug|dose|shot|injection|glp\W*1|semaglutide|tirzepatide|liraglutide|ozempic|wegovy|mounjaro|zepbound|saxenda|rybelsus)\b/i;

function detectTreatmentStopConcern(text: string): boolean {
  if (!text) return false;
  // Two cheap regex passes are faster than tokenizing for a 200-char
  // string. Both must match for the concern to fire.
  return STOP_VERB_RE.test(text) && TREATMENT_ANCHOR_RE.test(text);
}

const SYSTEM_PROMPT = `You are VIVA, a premium GLP-1 support coach. You know this person's medication, dose, recent trends, and daily state. You speak like a smart friend who truly gets what GLP-1 treatment feels like.

RESPONSE FORMAT:
1 short framing sentence grounded in their data.
2-3 practical actions max. No lists. Weave them naturally.
1 optional reason if it adds value.

That is it. 3-5 sentences total. Never more.

HARD RULES:
- NO numbered or bullet lists ever
- NO long paragraphs or explanations
- NO generic advice ("exercise, meditate, sleep")
- NO app recommendations
- NO em dashes. Use periods instead
- NO asterisks for formatting
- NO score language or clinical framing
- Keep hydration in cups, not liters
- NEVER use: dropout risk, churn, adherence risk, compliance risk, failing treatment
- NEVER tell someone to change their medication dose or schedule
- NO medical claims or diagnoses

TONE:
- Decisive and direct. Not verbose.
- Warm but confident. Not preachy.
- Use contractions naturally (you're, I'd, it's)
- Sound like a premium support layer, not a chatbot
- Normalize side effects without dismissing them

MEDICATION AWARENESS:
You always know their med, dose, frequency, whether they recently titrated, and how long they have been on treatment. Use this context naturally.

After dose increase: expect heavier side effects 1-2 weeks. Be gentler.
High dose + symptoms: simplify everything. Hydration and small protein meals first.
Stable dose + good recovery: encourage strength training and consistency.
Dose day or day after: more appetite-sensitive and side effect-aware guidance.
New to medication (less than 1 month): extra patience, simpler plans.

DECISION PRIORITIES:
Recovery over performance. Side effect management over training. Protein over calories. Consistency over intensity. Trends over single day data.

DATA INTO DIRECTION:
Never just state a number. Always connect it to what they should do.
"HRV is lower today" becomes "Recovery is strained, so keep things light and front-load your water."
"Sleep was short" becomes "Short sleep means protein and hydration matter extra today."

OFF-TOPIC: Briefly acknowledge, bridge to health or treatment, give one useful suggestion.

GOOD EXAMPLE:
"Recovery looks solid and your body seems to be handling treatment well. I'd do a strength session today. Compound movements, protein afterward. Days like this build real momentum."

ANOTHER GOOD EXAMPLE:
"Side effects are heavier today. Normal after a dose change. Keep it simple. Sip water, small bland meals, skip anything intense. This will pass."

GUARDRAILS:
- No medical claims or diagnoses
- Never tell someone to change their medication
- Frame side effects as manageable and temporary
- When data is limited, say so naturally and still be useful`;


// Per-signal confidence shape mirrored from pulse-pilot's central
// DailyTreatmentState. Kept here as a structural-only mirror; the
// canonical definition lives in artifacts/pulse-pilot/lib/engine/dailyState.ts.
type SignalConfidenceLevel = "none" | "low" | "medium" | "high";
interface SignalConfidence {
  isAvailable: boolean;
  canCite: boolean;
  confidenceLevel: SignalConfidenceLevel;
  confidenceReason: string | null;
}
interface SignalConfidenceMap {
  hrv: SignalConfidence;
  rhr: SignalConfidence;
  sleepDuration: SignalConfidence;
  sleepQuality: SignalConfidence;
  recovery: SignalConfidence;
  activity: SignalConfidence;
}

interface ChatRequestBody {
  message: string;
  healthContext?: {
    todayMetrics?: {
      hrv: number | null;
      restingHeartRate: number | null;
      sleepDuration: number;
      sleepQuality: number | null;
      steps: number;
      recoveryScore: number | null;
      weight: number | null;
      strain: number | null;
      caloriesBurned: number;
      activeCalories: number;
    };
    dataTier?: "self_report" | "phone_health" | "wearable";
    recommendationConfidence?: "low" | "moderate" | "high";
    availableMetricTypes?: string[];
    validBaselines?: { sleep7d: boolean; rhr14d: boolean; hrv14d: boolean; stepsWeekly: boolean };
    freshness?: { hasFreshSleep: boolean; hasFreshSteps: boolean; hasFreshRhr: boolean; hasFreshHrv: boolean };
    unavailableWearableMetrics?: string[];
    basedOn?: "self_report_only" | "phone_health" | "wearable_enhanced";
    profile?: {
      name?: string;
      age: number;
      sex: string;
      weight: number;
      goalWeight: number;
      goals: string[];
      glp1Medication?: string;
      glp1Duration?: string;
      proteinConfidence?: string;
      strengthTrainingBaseline?: string;
      availableWorkoutTime?: number;
      daysAvailableToTrain?: number;
    };
    recentTrends?: {
      weightTrend: string;
      hrvTrend: string;
      sleepTrend: string;
      stepsTrend: string;
    };
    treatmentState?: {
      treatmentDailyState: "escalate" | "recover" | "support" | "maintain" | "build" | "push";
      primaryFocus:
        | "symptom_relief"
        | "continuity_support"
        | "hydration"
        | "fueling"
        | "recovery"
        | "movement"
        | "performance";
      escalationNeed: "none" | "monitor" | "clinician";
      treatmentStage:
        | "first_30d"
        | "30_60d"
        | "60_90d"
        | "3_6m"
        | "6_12m"
        | "1y_plus"
        | "unknown";
      doseDayPosition:
        | "pre_dose"
        | "dose_day"
        | "day_1_post"
        | "day_2_post"
        | "day_3_post"
        | "mid_cycle"
        | "unknown";
      recentTitration: boolean;
      daysSinceLastDose: number | null;
      symptomBurden: "low" | "moderate" | "high";
      hydrationRisk: "low" | "moderate" | "high";
      fuelingRisk: "low" | "moderate" | "high";
      recoveryReadiness: "low" | "moderate" | "high";
      adherenceSignal: "stable" | "attention" | "rising";
      insufficientForPlan: boolean;
      claimsPolicy: {
        canCiteSleep: boolean;
        canCiteHRV: boolean;
        canCiteRecovery: boolean;
        canCiteSteps: boolean;
        canQuantifyReadiness: boolean;
        physiologicalClaimsAllowed: boolean;
        narrativeConfidence: "low" | "moderate" | "high";
        signalConfidence?: SignalConfidenceMap;
      };
      signalConfidence?: SignalConfidenceMap;
      communicationMode?:
        | "reassure"
        | "simplify"
        | "encourage_consistency"
        | "caution_and_monitor"
        | "escalate"
        | "reengage";
      dataTier: "self_report" | "phone_health" | "wearable";
      statusChipLabel: string;
      heroHeadline: string;
      heroDrivers: string[];
      interventionTitles: string[];
      rationale: string[];
    };
    userFeeling?: string;
    userEnergy?: string;
    userStress?: string;
    userHydration?: string;
    userTrainingIntent?: string;
    glp1DailyInputs?: {
      energy?: string | null;
      appetite?: string | null;
      hydration?: string | null;
      proteinConfidence?: string | null;
      sideEffects?: string | null;
      movementIntent?: string | null;
    };
    sleepInsight?: string;
    hrvBaseline?: number;
    hrvDeviation?: number;
    sleepDebt?: number;
    recoveryTrend?: string;
    weeklyCompletionRate?: number;
    streakDays?: number;
    weeklyConsistency?: number;
    medicationProfile?: {
      medicationBrand: string;
      genericName: string;
      doseValue: number;
      doseUnit: string;
      frequency: string;
      recentTitration: boolean;
      previousDoseValue?: number;
      timeOnMedicationBucket?: string;
      telehealthPlatform?: string;
      plannedDoseDay?: string;
    };
    recentDoseLog?: { date: string; status: string; doseValue: number; doseUnit: string }[];
  };
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
}


router.post("/chat", async (req: Request, res: Response) => {
  const reqId = Math.random().toString(36).slice(2, 8);
  const wantsStream = req.query.stream !== "false" && req.get("accept") !== "application/json";
  console.log(`[coach/chat ${reqId}] received: stream=${wantsStream} ua="${req.get("user-agent") || "?"}" len=${JSON.stringify(req.body || {}).length}b`);
  try {
    const body = req.body as ChatRequestBody;
    const { message, healthContext, conversationHistory } = body;
    console.log(`[coach/chat ${reqId}] payload: msgLen=${message?.length ?? 0} hasContext=${!!healthContext} historyLen=${conversationHistory?.length ?? 0}`);

    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY && !process.env.OPENAI_API_KEY) {
      console.error(`[coach/chat ${reqId}] missing OpenAI credentials`);
      res.status(500).json({ error: "Server missing AI credentials. Contact support." });
      return;
    }

    if (!message || typeof message !== "string") {
      console.warn(`[coach/chat ${reqId}] rejected: message missing`);
      res.status(400).json({ error: "Message is required" });
      return;
    }

    let contextBlock = "";
    // Defensive wrap: a malformed healthContext payload (missing or non-array
    // fields, wrong nested shapes) used to throw inside the builder below
    // and surface as a 500 to the user. On any error here we drop the
    // context entirely and continue with a vanilla coach response. The
    // mobile client also has a retry-without-context fallback, so this is
    // belt-and-suspenders.
    try {
    if (healthContext) {
      const parts: string[] = [];

      if (healthContext.todayMetrics) {
        const m = healthContext.todayMetrics;
        const metricLines: string[] = [`TODAY'S BIOMETRIC DATA:`];
        // Only render a metric line when the value is real. Null/zero (for counter-style
        // metrics) means the client suppressed it because the data tier or freshness gate
        // failed; we MUST NOT make the model invent a number.
        if (typeof m.hrv === "number") {
          metricLines.push(
            `- HRV: ${m.hrv} ms${healthContext.hrvBaseline ? ` (14-day baseline: ${healthContext.hrvBaseline} ms, ${healthContext.hrvDeviation && healthContext.hrvDeviation > 0 ? "+" : ""}${healthContext.hrvDeviation || 0}ms deviation)` : ""}`
          );
        }
        if (typeof m.restingHeartRate === "number") {
          metricLines.push(`- Resting Heart Rate: ${m.restingHeartRate} bpm`);
        }
        if (m.sleepDuration > 0) {
          const quality = typeof m.sleepQuality === "number" ? ` (${m.sleepQuality}% quality)` : "";
          metricLines.push(`- Sleep: ${m.sleepDuration.toFixed(1)} hours${quality}${healthContext.sleepDebt ? `, sleep debt: ${healthContext.sleepDebt} hours this week` : ""}`);
        }
        if (m.steps > 0) {
          metricLines.push(`- Steps: ${m.steps.toLocaleString()}`);
        }
        if (typeof m.recoveryScore === "number") {
          metricLines.push(`- Recovery Score: ${m.recoveryScore}%${healthContext.recoveryTrend ? ` (trend: ${healthContext.recoveryTrend})` : ""}`);
        }
        if (typeof m.weight === "number" && m.weight > 0) {
          metricLines.push(`- Weight: ${m.weight} lbs`);
        }
        if (typeof m.strain === "number") {
          metricLines.push(`- Strain: ${m.strain}`);
        }
        if (m.caloriesBurned > 0 || m.activeCalories > 0) {
          metricLines.push(`- Calories Burned: ${m.caloriesBurned} (${m.activeCalories} active)`);
        }
        if (metricLines.length > 1) {
          parts.push(...metricLines);
        }
      }

      if (healthContext.treatmentState) {
        const ts = healthContext.treatmentState;
        const tsLines: string[] = [`\nTREATMENT STATE (single source of truth for what the rest of the app is showing this person right now):`];
        tsLines.push(`- Status chip on Today: "${ts.statusChipLabel}"`);
        tsLines.push(`- Hero headline on Today: "${ts.heroHeadline}"`);
        if (Array.isArray(ts.heroDrivers) && ts.heroDrivers.length > 0) {
          tsLines.push(`- Hero drivers: ${ts.heroDrivers.join(" | ")}`);
        }
        tsLines.push(`- Daily state: ${ts.treatmentDailyState}`);
        tsLines.push(`- Primary focus: ${ts.primaryFocus}`);
        tsLines.push(`- Treatment stage: ${ts.treatmentStage}${ts.recentTitration ? " (recent dose change)" : ""}`);
        tsLines.push(`- Dose-day position: ${ts.doseDayPosition}${typeof ts.daysSinceLastDose === "number" ? ` (day ${ts.daysSinceLastDose} since last dose)` : ""}`);
        tsLines.push(`- Risk lenses: symptoms=${ts.symptomBurden}, hydration=${ts.hydrationRisk}, fueling=${ts.fuelingRisk}, recovery=${ts.recoveryReadiness}`);
        tsLines.push(`- Escalation need: ${ts.escalationNeed}`);
        if (Array.isArray(ts.interventionTitles) && ts.interventionTitles.length > 0) {
          tsLines.push(`- Symptom interventions surfaced today: ${ts.interventionTitles.join(", ")}`);
        }
        parts.push(...tsLines);
      }

      const selfReported: string[] = [];
      if (healthContext.userFeeling) selfReported.push(`Feeling: ${healthContext.userFeeling}`);
      if (healthContext.userEnergy) selfReported.push(`Energy: ${healthContext.userEnergy}`);
      if (healthContext.userStress) selfReported.push(`Stress: ${healthContext.userStress}`);
      if (healthContext.userHydration) selfReported.push(`Hydration: ${healthContext.userHydration}`);
      if (healthContext.userTrainingIntent) selfReported.push(`Training intent: ${healthContext.userTrainingIntent}`);
      if (selfReported.length > 0) {
        parts.push(`\nSELF-REPORTED STATE: ${selfReported.join(", ")}`);
      }

      if (healthContext.glp1DailyInputs) {
        const g = healthContext.glp1DailyInputs;
        const glp1Parts: string[] = [];
        if (g.energy) glp1Parts.push(`Energy: ${g.energy}`);
        if (g.appetite) glp1Parts.push(`Appetite: ${g.appetite}`);
        if (g.hydration) glp1Parts.push(`Hydration: ${g.hydration}`);
        if (g.proteinConfidence) glp1Parts.push(`Protein confidence: ${g.proteinConfidence}`);
        if (g.sideEffects) glp1Parts.push(`Side effects: ${g.sideEffects}`);
        if (g.movementIntent) glp1Parts.push(`Movement intent: ${g.movementIntent}`);
        if (glp1Parts.length > 0) {
          parts.push(`\nTODAY'S GLP-1 CHECK-IN: ${glp1Parts.join(", ")}`);
        }
      }

      if (healthContext.sleepInsight) {
        parts.push(`\nSLEEP INTELLIGENCE: ${healthContext.sleepInsight}`);
      }

      if (healthContext.profile) {
        const p = healthContext.profile;
        parts.push(
          `\nUSER PROFILE:`,
          `- Age: ${p.age}, Sex: ${p.sex}`,
          `- Current Weight: ${p.weight} lbs, Goal: ${p.goalWeight} lbs`,
          `- Goals: ${Array.isArray(p.goals) && p.goals.length > 0 ? p.goals.join(", ") : "not specified"}`,
          p.glp1Medication ? `- GLP-1 Medication: ${p.glp1Medication}` : "",
          p.glp1Duration ? `- Treatment Duration: ${p.glp1Duration}` : "",
          p.proteinConfidence ? `- Protein Confidence: ${p.proteinConfidence}` : "",
          p.strengthTrainingBaseline ? `- Strength Training: ${p.strengthTrainingBaseline}` : "",
          `- Available Time: ${p.availableWorkoutTime} min/session, ${p.daysAvailableToTrain} active days/week`,
        );
      }

      if (healthContext.recentTrends) {
        const t = healthContext.recentTrends;
        parts.push(
          `\n30-DAY TRENDS:`,
          `- Weight: ${t.weightTrend}`,
          `- HRV: ${t.hrvTrend}`,
          `- Sleep: ${t.sleepTrend}`,
          `- Steps: ${t.stepsTrend}`,
        );
      }

      const behavioral: string[] = [];
      if (healthContext.weeklyCompletionRate !== undefined && healthContext.weeklyCompletionRate >= 0) {
        behavioral.push(`Weekly completion rate: ${healthContext.weeklyCompletionRate}%`);
      }
      if (healthContext.streakDays !== undefined && healthContext.streakDays > 0) {
        behavioral.push(`Current streak: ${healthContext.streakDays} days`);
      }
      if (healthContext.weeklyConsistency !== undefined && healthContext.weeklyConsistency >= 0) {
        behavioral.push(`Weekly consistency: ${healthContext.weeklyConsistency}%`);
      }
      if (behavioral.length > 0) {
        parts.push(`\nBEHAVIORAL PATTERNS: ${behavioral.join(", ")}`);
      }

      if (healthContext.medicationProfile) {
        const med = healthContext.medicationProfile;
        const medParts: string[] = [
          `\nMEDICATION PROFILE:`,
          `- Brand: ${med.medicationBrand} (${med.genericName})`,
          `- Current Dose: ${med.doseValue} ${med.doseUnit} ${med.frequency}`,
        ];
        if (med.recentTitration) {
          medParts.push(`- Recent Titration: Yes${med.previousDoseValue ? ` (from ${med.previousDoseValue} ${med.doseUnit})` : ""}`);
        }
        if (med.timeOnMedicationBucket) {
          const bucketLabels: Record<string, string> = {
            less_30_days: "Less than 30 days",
            "30_60_days": "30-60 days",
            "60_90_days": "60-90 days",
            "3_6_months": "3-6 months",
            "6_12_months": "6-12 months",
            "1_2_years": "1-2 years",
            "2_plus_years": "2+ years",
            // Legacy keys kept so coach prompts remain readable for any
            // patient profile saved before the bucket schema migration.
            less_1_month: "Less than 1 month",
            "1_3_months": "1-3 months",
            "6_9_months": "6-9 months",
            "9_12_months": "9-12 months",
            "1_1_5_years": "1-1.5 years",
            "1_5_2_years": "1.5-2 years",
            "6_plus_months": "6+ months",
          };
          medParts.push(`- Time on Medication: ${bucketLabels[med.timeOnMedicationBucket] || med.timeOnMedicationBucket}`);
        }
        if (med.telehealthPlatform) medParts.push(`- Telehealth: ${med.telehealthPlatform}`);
        if (med.plannedDoseDay) medParts.push(`- Planned Dose Day: ${med.plannedDoseDay}`);
        parts.push(...medParts);
      }

      if (healthContext.recentDoseLog && healthContext.recentDoseLog.length > 0) {
        const logLines = healthContext.recentDoseLog.map(e => `${e.date}: ${e.status} (${e.doseValue} ${e.doseUnit})`);
        parts.push(`\nRECENT DOSE LOG:\n${logLines.join("\n")}`);
      }

      contextBlock = parts.filter(Boolean).join("\n");
    }
    } catch (ctxErr) {
      console.warn(
        `[coach/chat ${reqId}] healthContext build failed; dropping context:`,
        (ctxErr as Error)?.message || ctxErr,
      );
      contextBlock = "";
    }

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    if (contextBlock) {
      const userName = healthContext?.profile?.name;
      const nameNote = userName ? ` Their name is ${userName}. Use it occasionally and naturally. Not every message. Maybe once in a few exchanges. Never force it.` : "";
      messages.push({
        role: "system",
        content: `This is what you know about this person right now. Use it naturally. Don't list their stats back to them. Instead, interpret what the data means and talk to them like you understand their situation. Keep it human.${nameNote}\n\n${contextBlock}`,
      });
    }

    // Claims-policy guardrail. ALWAYS injected, regardless of whether a context
    // block was rendered. The treatment state's claimsPolicy is the single source
    // of truth for what the coach is allowed to assert. If a caller forgot to send
    // treatmentState (or sent no healthContext at all), we fall back to a strict
    // deny-all policy + insufficient-data tone so this endpoint can NEVER be
    // jailbroken into making physiological claims by an unmigrated client.
    {
      // Deny-all signal confidence fallback. Used when an unmigrated client
      // omits signalConfidence -- every signal is forbidden from mention.
      const denyAllConfidence = (reason: string): SignalConfidence => ({
        isAvailable: false,
        canCite: false,
        confidenceLevel: "none",
        confidenceReason: reason,
      });
      const denyAllSignalConfidence: SignalConfidenceMap = {
        hrv:           denyAllConfidence("no treatment state was sent with this request"),
        rhr:           denyAllConfidence("no treatment state was sent with this request"),
        sleepDuration: denyAllConfidence("no treatment state was sent with this request"),
        sleepQuality:  denyAllConfidence("no treatment state was sent with this request"),
        recovery:      denyAllConfidence("no treatment state was sent with this request"),
        activity:      denyAllConfidence("no treatment state was sent with this request"),
      };

      const tsRaw = healthContext?.treatmentState;
      // Treat an incomplete treatmentState (missing claimsPolicy) as if it
      // were absent, so the deny-all defaults below kick in instead of the
      // claims-policy block crashing on undefined property access.
      const ts = (tsRaw && tsRaw.claimsPolicy) ? tsRaw : {
        treatmentDailyState: "support" as const,
        primaryFocus: "continuity_support" as const,
        escalationNeed: "none" as const,
        treatmentStage: "unknown" as const,
        doseDayPosition: "unknown" as const,
        recentTitration: false,
        daysSinceLastDose: null,
        symptomBurden: "low" as const,
        hydrationRisk: "low" as const,
        fuelingRisk: "low" as const,
        recoveryReadiness: "low" as const,
        adherenceSignal: "stable" as const,
        insufficientForPlan: true,
        claimsPolicy: {
          canCiteSleep: false,
          canCiteHRV: false,
          canCiteRecovery: false,
          canCiteSteps: false,
          canQuantifyReadiness: false,
          physiologicalClaimsAllowed: false,
          narrativeConfidence: "low" as const,
          signalConfidence: denyAllSignalConfidence,
        },
        signalConfidence: denyAllSignalConfidence,
        communicationMode: "simplify" as const,
        dataTier: "self_report" as const,
        statusChipLabel: "Set up your day",
        heroHeadline: "Tell us how today is going",
        heroDrivers: [],
        interventionTitles: [],
        rationale: [],
      };
      // Resolve the per-signal confidence map. Prefer the top-level
      // `signalConfidence` (newer wire shape), fall back to the one
      // nested in claimsPolicy, and only finally fall back to deny-all.
      const signalConfidence: SignalConfidenceMap =
        ts.signalConfidence ?? ts.claimsPolicy?.signalConfidence ?? denyAllSignalConfidence;
      const communicationMode = ts.communicationMode ?? "simplify";
      {
        const cp = ts.claimsPolicy;
        const allowed: string[] = [];
        const forbidden: string[] = [];
        (cp.canCiteSleep ? allowed : forbidden).push("sleep duration");
        (cp.canCiteSleep && cp.physiologicalClaimsAllowed ? allowed : forbidden).push("sleep quality");
        (cp.canCiteHRV ? allowed : forbidden).push("HRV");
        (cp.canCiteHRV ? allowed : forbidden).push("resting heart rate");
        (cp.canCiteRecovery ? allowed : forbidden).push("recovery score");
        (cp.canCiteSteps ? allowed : forbidden).push("steps and active calories");
        (cp.physiologicalClaimsAllowed ? allowed : forbidden).push("readiness, body-is-responding-well, or other physiological-state claims");
        (cp.canQuantifyReadiness ? allowed : forbidden).push("citing a numeric readiness score");

        const cpLines: string[] = [
          `CLAIMS POLICY (single source of truth, do not deviate):`,
          `- ALLOWED to reference: ${allowed.length > 0 ? allowed.join(", ") : "none of the physiological signals below"}.`,
          `- FORBIDDEN to reference, even if the user asks: ${forbidden.join(", ")}.`,
          `- If the user asks about a forbidden signal, say plainly that the app does not have that data for them today and pivot to what they did report.`,
          `- Narrative confidence: ${cp.narrativeConfidence}. Match your hedge level to this. "low" = "based on what you've shared today", "moderate" = practical without strong claims, "high" = direct and specific.`,
          `- Data tier: ${ts.dataTier}. This is informational; the allow/deny list above governs what you can say.`,
        ];
        messages.push({ role: "system", content: cpLines.join("\n") });

        // Per-signal confidence guidance. The CLAIMS POLICY above is binary
        // (allowed vs forbidden); this section tells the model HOW STRONGLY
        // it may frame anything it IS allowed to reference.
        //   none   -> still forbidden; never mention
        //   low    -> heavily hedged ("based on what you've shared today, ..."); never causal
        //   medium -> may mention as a possible pattern, not a direct measurement
        //   high   -> may mention more directly, but never as medical certainty
        const signalLabels: { key: keyof SignalConfidenceMap; label: string }[] = [
          { key: "hrv",           label: "HRV" },
          { key: "rhr",           label: "resting heart rate" },
          { key: "sleepDuration", label: "sleep duration" },
          { key: "sleepQuality",  label: "sleep quality" },
          { key: "recovery",      label: "recovery / readiness" },
          { key: "activity",      label: "activity / steps" },
        ];
        const confLines: string[] = [
          `SIGNAL CONFIDENCE (modulates wording for any signal you ARE allowed to reference; never overrides CLAIMS POLICY):`,
        ];
        let confidenceListedAny = false;
        for (const { key, label } of signalLabels) {
          const sc = signalConfidence[key];
          const reason = sc.confidenceReason ? ` -- ${sc.confidenceReason}` : "";
          if (sc.confidenceLevel === "none") {
            // Suppressed signal: redundant with the CLAIMS POLICY forbidden list,
            // so we omit it here unless we have a meaningful reason to surface
            // why (helps the model explain the gap if asked).
            if (sc.confidenceReason) {
              confLines.push(`- ${label}: do not mention${reason}`);
              confidenceListedAny = true;
            }
            continue;
          }
          confidenceListedAny = true;
          if (sc.confidenceLevel === "low") {
            confLines.push(`- ${label}: LOW confidence. Mention only if directly useful, and always heavily hedged ("based on what you've shared today"). Never causal language${reason}.`);
          } else if (sc.confidenceLevel === "medium") {
            confLines.push(`- ${label}: MEDIUM confidence. Frame as a possible pattern, not a direct measurement${reason}.`);
          } else {
            confLines.push(`- ${label}: HIGH confidence. May reference more directly, but never as medical certainty${reason}.`);
          }
        }
        if (confidenceListedAny) {
          messages.push({ role: "system", content: confLines.join("\n") });
        }

        // Treatment-state tone rules. These keep the coach aligned with what the Today
        // and weekly surfaces are showing the patient right now.
        const toneLines: string[] = [`TONE & FRAMING (must match the rest of the app this person is looking at):`];

        // Communication-mode header. Single behavior-strategy directive
        // derived centrally; every detailed addendum below is a refinement
        // of this top-level mode, not a parallel decision.
        const modeRules: Record<typeof communicationMode, string> = {
          reassure:
            `- Communication mode: REASSURE. Early in treatment or recently changed dose. Be calm, patient, and normalize the experience. Lower the bar on what counts as a good day. Do not push performance.`,
          simplify:
            `- Communication mode: SIMPLIFY. Not enough input today. Ask for ONE concrete next input (how they feel, energy, appetite, or any side effects). Do not list multiple metrics. Do not give a detailed plan.`,
          encourage_consistency:
            `- Communication mode: ENCOURAGE_CONSISTENCY. Things look stable and engaged. Reinforce the streak quietly, suggest one specific next step that compounds it. Do not over-praise.`,
          caution_and_monitor:
            `- Communication mode: CAUTION_AND_MONITOR. Symptoms are stacking. Be careful and supportive, not performance-oriented. Hydration, rest, small bland meals come first. No training prescriptions today.`,
          escalate:
            `- Communication mode: ESCALATE. Symptoms warrant talking to the care team. Be calm, supportive, and explicitly suggest contacting their prescriber or care team. Do NOT prescribe specific protocols, doses, or medical action. No performance language.`,
          reengage:
            `- Communication mode: REENGAGE. Engagement is dropping. Use a warmer, lower-pressure tone. Smaller asks. More reassurance. Never mention compliance, dropout, churn, or risk.`,
        };
        toneLines.push(modeRules[communicationMode]);

        if (ts.insufficientForPlan) {
          toneLines.push(
            `- The Today screen is showing "Set up your day" because there is not enough input yet to personalize. Do NOT pretend to know how they are doing physiologically. Acknowledge the gap warmly and guide them toward the single most useful next input (a quick check-in: how they feel, energy, appetite, any side effects). One concrete suggestion. Do not list multiple metrics to log.`,
            `- Do not give detailed plan recommendations until they share a check-in.`,
          );
        }
        if (ts.escalationNeed === "clinician") {
          toneLines.push(
            `- Escalation level: clinician. This person's symptoms warrant talking to their care team. Be calm, supportive, and explicitly suggest they contact their prescriber or care team. Do NOT prescribe specific protocols, doses, or medical action. No performance language.`,
          );
        } else if (ts.escalationNeed === "monitor") {
          toneLines.push(
            `- Escalation level: monitor. Symptoms are stacking. Be careful and supportive, not performance-oriented. Hydration, rest, small bland meals come first. No training prescriptions today.`,
          );
        }
        if (ts.treatmentDailyState === "escalate") {
          toneLines.push(`- The Today hero is "${ts.heroHeadline}". Echo that frame: stabilize first, performance later.`);
        } else if (ts.treatmentDailyState === "support") {
          toneLines.push(`- This is a support day, not a performance day. The Today screen is in "${ts.statusChipLabel}" mode. Lean into reassurance and small, doable steps.`);
        } else if (ts.treatmentDailyState === "push" || ts.treatmentDailyState === "build") {
          toneLines.push(`- This is a green-light day. Encourage the harder work the person is capable of, while staying within what their data supports.`);
        }
        if (ts.recentTitration || ts.treatmentStage === "first_30d") {
          toneLines.push(`- Treatment context: ${ts.recentTitration ? "recent dose change" : "first 30 days of treatment"}. Extra patience. Normalize side effects without dismissing them.`);
        }
        if (ts.adherenceSignal === "rising" || ts.adherenceSignal === "attention") {
          toneLines.push(`- Internal note (NEVER say to the user): adherence signal is "${ts.adherenceSignal}". Use a warmer, lower-pressure tone. Smaller asks. More reassurance. Do not mention compliance, dropout, or risk.`);
        }
        if (ts.primaryFocus === "hydration") {
          toneLines.push(`- Primary focus today is hydration. Anchor your response there.`);
        } else if (ts.primaryFocus === "fueling") {
          toneLines.push(`- Primary focus today is fueling. Small, protein-forward portions.`);
        } else if (ts.primaryFocus === "symptom_relief") {
          toneLines.push(`- Primary focus today is symptom relief. Lead with the active intervention(s) listed above, not generic wellness advice.`);
        } else if (ts.primaryFocus === "continuity_support") {
          toneLines.push(`- Primary focus today is continuity support. Keep momentum without adding pressure.`);
        }
        messages.push({ role: "system", content: toneLines.join("\n") });
      }
    }

    if (conversationHistory && conversationHistory.length > 0) {
      const recent = conversationHistory.slice(-10);
      for (const msg of recent) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: "user", content: message });

    console.log(`[coach/chat ${reqId}] calling OpenAI: model=gpt-4o-mini messages=${messages.length} stream=${wantsStream}`);

    // Best-effort identity resolution for persistence. Done once per
    // request and reused for both the user-message and assistant-
    // message inserts. If null we silently skip persistence so we
    // never break the chat path on a DB or auth hiccup.
    const patientUserId = await resolvePatientUserId(req);
    const coachMode =
      healthContext?.treatmentState?.communicationMode ?? null;

    if (patientUserId !== null) {
      // Persist the user message and detect a treatment-stop concern
      // in parallel. Both are best-effort -- failures are logged and
      // swallowed so the chat path always returns to the user.
      void db
        .insert(coachMessagesTable)
        .values({
          patientUserId,
          role: "user",
          body: message,
          mode: coachMode,
        })
        .catch((err) => {
          console.error(`[coach/chat ${reqId}] coach_messages user insert failed`, err);
        });

      if (detectTreatmentStopConcern(message)) {
        // Use the existing escalation_requested type with a metadata
        // reason so the clinician needs-review query (which already
        // groups by escalation_requested) picks this up without an
        // enum migration. The mobile app's explicit Request review
        // button uses the same type, so the dashboard surface is
        // already wired.
        void db
          .insert(careEventsTable)
          .values({
            patientUserId,
            actorUserId: patientUserId,
            source: "patient",
            type: "escalation_requested",
            metadata: {
              reason: "treatment_stop_question",
              channel: "coach",
              messagePreview: message.slice(0, 240),
            },
          })
          .catch((err) => {
            console.error(`[coach/chat ${reqId}] treatment-stop care_event insert failed`, err);
          });
      }
    }

    if (!wantsStream) {
      // Non-streaming JSON path. Used by React Native (no SSE support in fetch).
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 8192,
        messages,
        stream: false,
      });
      const content = completion.choices[0]?.message?.content || "";
      console.log(`[coach/chat ${reqId}] returned JSON: contentLen=${content.length}`);
      res.json({ content });
      // Fire-and-forget assistant persistence after the response goes
      // out. Same best-effort posture as the user-message insert.
      if (patientUserId !== null && content) {
        void db
          .insert(coachMessagesTable)
          .values({
            patientUserId,
            role: "assistant",
            body: content,
            mode: coachMode,
          })
          .catch((err) => {
            console.error(`[coach/chat ${reqId}] coach_messages assistant insert failed`, err);
          });
      }
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 8192,
      messages,
      stream: true,
    });

    // Accumulate the full assistant body for persistence. The streamed
    // chunks are both written to the SSE client and concatenated here
    // so we end up with one canonical assistant string.
    let fullContent = "";
    let totalLen = 0;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        totalLen += content.length;
        fullContent += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    console.log(`[coach/chat ${reqId}] returned stream: contentLen=${totalLen}`);

    if (patientUserId !== null && fullContent) {
      void db
        .insert(coachMessagesTable)
        .values({
          patientUserId,
          role: "assistant",
          body: fullContent,
          mode: coachMode,
        })
        .catch((err) => {
          console.error(`[coach/chat ${reqId}] coach_messages assistant insert failed`, err);
        });
    }
  } catch (error: any) {
    console.error(`[coach/chat ${reqId}] error:`, error?.message || error);
    console.error(`[coach/chat ${reqId}] error type:`, error?.constructor?.name);
    console.error(`[coach/chat ${reqId}] error status:`, error?.status || error?.response?.status);
    if (error?.response?.data) console.error(`[coach/chat ${reqId}] error data:`, JSON.stringify(error.response.data));

    let statusCode = 500;
    let errorDetail = "Failed to generate response";

    if (error?.status === 401 || error?.message?.includes("auth") || error?.message?.includes("API key")) {
      statusCode = 401;
      errorDetail = "AI service authentication failed. API key may be missing or invalid.";
    } else if (error?.status === 429) {
      statusCode = 429;
      errorDetail = "AI service rate limited. Try again shortly.";
    } else if (error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND") {
      errorDetail = `AI service unreachable (${error.code}).`;
    } else if (error?.message) {
      errorDetail = `AI error: ${error.message}`;
    }

    if (!res.headersSent) {
      res.status(statusCode).json({ error: errorDetail });
    } else {
      res.write(`data: ${JSON.stringify({ error: errorDetail })}\n\n`);
      res.end();
    }
  }
});

const WEEKLY_PLAN_PROMPT = `You are VIVA, a supportive health coach generating a personalized weekly plan for someone on GLP-1 medication.

DATA WEIGHTING:
- 60% = Apple Health data (sleep, HRV, resting HR, strain, steps, recovery trends)
- 40% = self-reported inputs (energy, appetite, side effects, hydration, protein confidence)
- When the two conflict, prioritize Apple Health data but still acknowledge the user's current state

Based on the user's health data, goals, GLP-1 treatment status, recent behavior, and trends, generate a 7-day plan covering 5 daily support categories:

1. Move: movement recommendation ("30 min strength", "20 min walk", "Gentle walk", "Rest day", etc.)
2. Fuel: nutrition focus ("Protein-rich meals", "Small frequent meals", "Recovery nutrition", etc.)
3. Hydrate: hydration target in cups ("8 cups water", "10+ cups water", "Water + electrolytes", etc.)
4. Recover: sleep/recovery target ("Bed by 10:00 pm", "Aim for 8 hours", "Wind down early", etc.)
5. Consistent: consistency action ("Daily check-in", "Log meals", "Track symptoms", etc.)

GLP-1 SPECIFIC RULES:
- Prioritize strength training 2-3x per week for muscle preservation
- On heavy symptom days, only prescribe gentle walking
- After dose changes, plan 1-2 lighter weeks
- Always include protein focus in fueling
- Hydration minimum 8 cups daily, more on active days
- Walking after meals helps with nausea and digestion
- Under-eating is as big a risk as overeating. Watch for it.
- NEVER use these words: dropout risk, churn, adherence risk, compliance risk, failing treatment

DECISION RULES (apply to each day):
- Sleep < 6.5h: reduce intensity, keep movement gentle
- Sleep < 6h AND HRV down > 10%: full recovery day (walk only)
- Sleep declining 3+ days: prioritize sleep over activity
- Sleep > 7.5h AND HRV above baseline: good day for strength session or longer walk
- HRV down > 15% from average: recovery protocol
- HRV stable BUT resting HR elevated > 5 bpm: moderate only
- Low appetite: emphasize nutrient-dense, protein-rich foods
- Heavy side effects: simplify everything, gentle movement only

PRIORITIZATION: Recovery > performance. Side effect management > training goals. Protein > calories. Consistency > intensity. Trends > single day.

IMPORTANT RULES:
- Keep each recommendation SHORT: 2-5 words max
- Use cups for all hydration, never liters
- Never use em dashes
- Make the plan feel supportive and personalized, not templated
- Include 2-3 lighter/recovery days per week
- Balance the week: don't put all hard days together
- Each day should have a focusArea that pairs physical and recovery themes

The weekSummary should be 2-3 sentences explaining the week's focus and how it was shaped by the user's actual data patterns. Be specific, not generic.

Respond ONLY with valid JSON in this exact format:
{
  "weekSummary": "...",
  "days": [
    {
      "dayOfWeek": "Monday",
      "focusArea": "...",
      "move": "...",
      "fuel": "...",
      "hydrate": "...",
      "recover": "...",
      "consistent": "..."
    }
  ],
  "adjustmentNote": "..."
}`;

router.post("/weekly-plan", async (req: Request, res: Response) => {
  try {
    const { healthContext } = req.body;

    let contextBlock = "";
    if (healthContext) {
      const parts: string[] = [];

      if (healthContext.recentMetrics && Array.isArray(healthContext.recentMetrics)) {
        const recent = healthContext.recentMetrics.slice(-7);
        const older = healthContext.recentMetrics.slice(-14, -7);
        const avgSleep = recent.reduce((s: number, m: any) => s + m.sleepDuration, 0) / recent.length;
        const avgSteps = recent.reduce((s: number, m: any) => s + m.steps, 0) / recent.length;
        const avgRecovery = recent.reduce((s: number, m: any) => s + m.recoveryScore, 0) / recent.length;
        const avgHrv = recent.reduce((s: number, m: any) => s + m.hrv, 0) / recent.length;
        const avgStrain = recent.reduce((s: number, m: any) => s + m.strain, 0) / recent.length;
        const avgRhr = recent.reduce((s: number, m: any) => s + m.restingHeartRate, 0) / recent.length;
        const avgSleepQuality = recent.reduce((s: number, m: any) => s + m.sleepQuality, 0) / recent.length;

        parts.push(
          `LAST 7 DAYS (BIOMETRIC DATA, 60% weight):`,
          `- Avg Sleep: ${avgSleep.toFixed(1)} hours (${Math.round(avgSleepQuality)}% quality)`,
          `- Avg Steps: ${Math.round(avgSteps).toLocaleString()}/day`,
          `- Avg Recovery: ${Math.round(avgRecovery)}%`,
          `- Avg HRV: ${Math.round(avgHrv)} ms`,
          `- Avg Resting HR: ${Math.round(avgRhr)} bpm`,
          `- Avg Strain: ${avgStrain.toFixed(1)}`,
        );

        if (older.length >= 3) {
          const olderRecovery = older.reduce((s: number, m: any) => s + m.recoveryScore, 0) / older.length;
          const olderSleep = older.reduce((s: number, m: any) => s + m.sleepDuration, 0) / older.length;
          const olderHrv = older.reduce((s: number, m: any) => s + m.hrv, 0) / older.length;
          const recoveryChange = avgRecovery - olderRecovery;
          const sleepChange = avgSleep - olderSleep;
          const hrvChange = avgHrv - olderHrv;
          parts.push(
            `\nWEEK-OVER-WEEK CHANGES:`,
            `- Recovery: ${recoveryChange > 0 ? "+" : ""}${Math.round(recoveryChange)}%`,
            `- Sleep: ${sleepChange > 0 ? "+" : ""}${sleepChange.toFixed(1)} hours`,
            `- HRV: ${hrvChange > 0 ? "+" : ""}${Math.round(hrvChange)} ms`,
          );
        }

        const lowSleepDays = recent.filter((m: any) => m.sleepDuration < 6.5).length;
        const lowRecoveryDays = recent.filter((m: any) => m.recoveryScore < 50).length;
        const lowStepDays = recent.filter((m: any) => m.steps < 5000).length;
        const flags: string[] = [];
        if (lowSleepDays >= 3) flags.push(`${lowSleepDays} days of short sleep`);
        if (lowRecoveryDays >= 3) flags.push(`${lowRecoveryDays} days of low recovery`);
        if (lowStepDays >= 3) flags.push(`${lowStepDays} days of low movement`);
        if (flags.length > 0) {
          parts.push(`\nPATTERN FLAGS: ${flags.join(", ")}`);
        }
      }

      if (healthContext.profile) {
        const p = healthContext.profile;
        parts.push(
          `\nUSER PROFILE:`,
          `- Age: ${p.age}, Sex: ${p.sex}`,
          `- Goals: ${p.goals?.join(", ") || "feel better on treatment"}`,
          `- Active days per week: ${p.daysAvailableToTrain || 4}`,
          `- Available time per session: ${p.availableWorkoutTime || 45} min for activity`,
        );
      }

      if (healthContext.wellnessInputs) {
        const w = healthContext.wellnessInputs;
        const inputs: string[] = [];
        if (w.feeling) inputs.push(`Feeling: ${w.feeling}`);
        if (w.energy) inputs.push(`Energy: ${w.energy}`);
        if (w.stress) inputs.push(`Stress: ${w.stress}`);
        if (w.hydration) inputs.push(`Hydration: ${w.hydration}`);
        if (inputs.length > 0) {
          parts.push(`\nSELF-REPORTED STATE (40% weight): ${inputs.join(", ")}`);
        }
      }

      if (healthContext.completionHistory && Array.isArray(healthContext.completionHistory)) {
        const recent = healthContext.completionHistory.slice(-7);
        if (recent.length > 0) {
          const avgCompletion = recent.reduce((s: number, r: any) => s + r.completionRate, 0) / recent.length;
          const categoryStats: Record<string, { done: number; total: number }> = {};
          for (const r of recent) {
            if (r.actions) {
              for (const a of r.actions) {
                if (!categoryStats[a.category]) categoryStats[a.category] = { done: 0, total: 0 };
                categoryStats[a.category].total++;
                if (a.completed) categoryStats[a.category].done++;
              }
            }
          }
          const weakCategories = Object.entries(categoryStats)
            .filter(([, v]) => v.total >= 3 && v.done / v.total < 0.4)
            .map(([k]) => k);

          parts.push(`\nBEHAVIORAL DATA:`);
          parts.push(`- Last week completion: ${Math.round(avgCompletion)}%`);
          if (weakCategories.length > 0) {
            parts.push(`- Weak categories (under 40% completion): ${weakCategories.join(", ")}`);
            parts.push(`  Note: simplify recommendations for weak categories to build consistency`);
          }
        }
      }

      contextBlock = parts.filter(Boolean).join("\n");
    }

    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: WEEKLY_PLAN_PROMPT },
    ];

    if (contextBlock) {
      messages.push({
        role: "user",
        content: `Here is my health data. Generate a personalized weekly plan based on this. Remember: 60% weight on biometric data, 40% on self-reported state:\n\n${contextBlock}`,
      });
    } else {
      messages.push({
        role: "user",
        content: "Generate a balanced weekly support plan for someone on GLP-1 treatment. Focus on protein intake, gentle movement, hydration, and treatment consistency.",
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 2048,
      messages,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    const plan = JSON.parse(content);
    res.json(plan);
  } catch (error: any) {
    console.error("Weekly plan generation error:", error);
    res.status(500).json({ error: "Failed to generate weekly plan" });
  }
});

export default router;
