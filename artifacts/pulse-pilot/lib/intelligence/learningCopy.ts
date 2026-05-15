import type { PatientIntelligenceContext } from "./patientContext";

// -------------------------------------------------------------------------
// Learning-oriented copy generators.
//
// Rules:
//  * Rule-based only — no LLM, no free-text PHI.
//  * All strings come from approved templates; no dynamic medical advice.
//  * Returns null when there is not enough signal to say something useful.
//  * For severe / worsening or urgent symptoms, always append the safety footer.
// -------------------------------------------------------------------------

const SAFETY_FOOTER =
  "Viva supports between-visit care. For severe, worsening or urgent symptoms, contact your care team or seek medical attention.";

// ---- shared helpers -------------------------------------------------------

function isSevereOrWorsening(ctx: PatientIntelligenceContext): boolean {
  return (
    ctx.symptoms.overallBurden === "severe" ||
    ctx.symptoms.overallBurden === "high" ||
    ctx.trends.overallTrend === "worsening"
  );
}

// ---- buildPlanLearningLine ------------------------------------------------
// One sentence shown above the today plan (replaces the static symptom
// banner text). Returns null when there is nothing worth surfacing.

export function buildPlanLearningLine(
  ctx: PatientIntelligenceContext,
): string | null {
  const { symptoms, trends, medication, engagement, wearable } = ctx;

  // Safety: worsening / severe always gets the footer only.
  if (isSevereOrWorsening(ctx)) {
    return SAFETY_FOOTER;
  }

  // Recent dose change with active symptoms — prioritize this over everything else.
  if (medication.doseChangedRecently && symptoms.overallBurden !== "none") {
    return "Viva is weighting today's symptoms more carefully because your dose was recently updated.";
  }

  // High dose + GI symptoms.
  if (medication.doseTier === "high" && symptoms.hasElevatedGI) {
    return "Today's plan is adjusted for your current dose context and GI symptoms.";
  }

  // Dose-day nausea pattern.
  if (medication.recentTitration === false && trends.doseDayPatternLikely && symptoms.nausea !== null && symptoms.nausea !== "none") {
    return "Nausea tends to peak shortly after your dose — today's plan is adjusted accordingly.";
  }

  // Within dose window AND recent titration.
  if (medication.recentTitration && symptoms.overallBurden !== "none") {
    return "Your body is adjusting to the new dose. Today's plan is lighter to support that transition.";
  }

  // Dose window nausea without titration.
  if (trends.doseDayPatternLikely && medication.daysSinceDose !== null && medication.daysSinceDose <= 2) {
    return "Nausea tends to peak shortly after your dose — today's plan is adjusted accordingly.";
  }

  // GI elevated.
  if (symptoms.hasElevatedGI) {
    if (symptoms.overallBurden === "moderate") {
      return "GI symptoms are a bit elevated today — plan items are lightened to match.";
    }
    return "GI symptoms are present — rest, hydration and bland foods are emphasized today.";
  }

  // Improving trend — positive reinforcement.
  if (
    trends.overallTrend === "improving" &&
    symptoms.overallBurden !== "none" &&
    engagement.engagementState !== "dropping"
  ) {
    return "Symptoms are trending better — keep going.";
  }

  // Dropping engagement.
  if (engagement.engagementState === "dropping" && engagement.checkInStreak === 0) {
    return "Welcome back. Your plan is ready whenever you are.";
  }

  // Good streak.
  if (engagement.checkInStreak >= 7) {
    return `${engagement.checkInStreak} days of check-ins — Viva's plan is getting more precise.`;
  }
  if (engagement.checkInStreak >= 3) {
    return "Consistent check-ins help Viva tailor your plan more accurately.";
  }

  // Wearable connected, improving data confidence.
  if (wearable.connected && ctx.dataConfidence === "high") {
    return "Health data and daily check-ins are shaping your plan.";
  }

  // Low data confidence nudge.
  if (ctx.dataConfidence === "low") {
    return "Add more daily check-ins so Viva can personalize your plan.";
  }

  // Low symptom burden, stable — quiet positive.
  if (symptoms.overallBurden === "none" || symptoms.overallBurden === "low") {
    if (trends.overallTrend === "stable") {
      return "Symptoms are stable. Your plan supports continued progress.";
    }
  }

  return null;
}

// ---- buildInterventionWhyLine --------------------------------------------
// One sentence in "Why Viva suggested this" section of InterventionCard.
// Supplements (does not replace) the existing contextParagraph derived from chips.

export function buildInterventionWhyLine(
  ctx: PatientIntelligenceContext,
): string | null {
  const { symptoms, medication, trends, engagement } = ctx;

  if (isSevereOrWorsening(ctx)) {
    return SAFETY_FOOTER;
  }

  if (medication.doseChangedRecently) {
    return "Recent dose changes can make symptoms more noticeable — this step uses gentle support.";
  }

  if (trends.doseDayPatternLikely && medication.daysSinceDose !== null && medication.daysSinceDose <= 2) {
    return "This intervention is timed to your typical post-dose pattern.";
  }

  if (medication.recentTitration) {
    return "A recent dose change means your body may need extra support right now.";
  }

  if (symptoms.hasElevatedGI && symptoms.nausea !== null && symptoms.nausea !== "none") {
    return "Nausea is elevated — this step targets GI comfort directly.";
  }

  if (symptoms.hasElevatedGI) {
    return "GI symptoms are elevated — this step is selected to ease digestive discomfort.";
  }

  if (trends.overallTrend === "improving") {
    return "Symptoms are trending better — this supports continued momentum.";
  }

  if (engagement.checkInStreak >= 5) {
    return `${engagement.checkInStreak} days of check-ins give Viva more confidence in this suggestion.`;
  }

  return null;
}

// ---- buildWeekSummaryLearningLine ----------------------------------------
// One sentence shown below the weekly summary paragraph on the plan tab.

export function buildWeekSummaryLearningLine(
  ctx: PatientIntelligenceContext,
): string | null {
  const { symptoms, trends, engagement, medication, wearable } = ctx;

  if (isSevereOrWorsening(ctx)) {
    return SAFETY_FOOTER;
  }

  // Positive trend over the week.
  if (trends.overallTrend === "improving") {
    if (engagement.planCompletionRate7d >= 0.7) {
      return "Strong completion and improving symptoms — the plan is working.";
    }
    return "Symptoms are trending better this week.";
  }

  // High completion, stable symptoms.
  if (engagement.planCompletionRate7d >= 0.8 && symptoms.overallBurden !== "high") {
    return `${Math.round(engagement.planCompletionRate7d * 100)}% plan completion this week — great consistency.`;
  }

  // Pattern: dose-day nausea recurring.
  if (trends.doseDayPatternLikely) {
    return "Nausea pattern linked to dose days — this week's plan accounts for that.";
  }

  // Wearable contributing.
  if (wearable.connected && ctx.dataConfidence === "high") {
    return "Sleep and activity data are informing this week's plan.";
  }

  // Recent dose change (settings-tracked) takes precedence over recentTitration flag.
  if (medication.doseChangedRecently) {
    return "You're adjusting to a recent dose change — this week's plan accounts for that.";
  }

  // Older recentTitration flag (set during onboarding).
  if (medication.recentTitration) {
    return "You're adjusting to a new dose — this week's plan is calibrated for that transition.";
  }

  // New to program.
  if (engagement.checkInStreak >= 1 && engagement.checkInStreak <= 7) {
    return "Early days — the plan will sharpen as you add more check-ins.";
  }

  // Low completion.
  if (engagement.planCompletionRate7d < 0.4 && engagement.checkInStreak > 0) {
    return "Fewer completions this week — your plan adjusts automatically as you check in.";
  }

  return null;
}

// ---- buildEngagementAck --------------------------------------------------
// Short inline acknowledgement shown when a plan item is completed or
// when the engagement streak crosses a milestone.

export function buildEngagementAck(
  ctx: PatientIntelligenceContext,
): string | null {
  const { engagement } = ctx;

  if (engagement.checkInStreak === 7) {
    return "One week of check-ins — Viva's plan is now meaningfully personalized.";
  }
  if (engagement.checkInStreak === 14) {
    return "Two weeks in. Your pattern data is helping Viva refine support timing.";
  }
  if (engagement.checkInStreak === 30) {
    return "30 days of check-ins. Viva has a clear picture of your treatment journey.";
  }

  if (engagement.planCompletionRate7d >= 0.9 && engagement.checkInStreak >= 5) {
    return "High consistency — you're giving Viva the data it needs.";
  }

  return null;
}
