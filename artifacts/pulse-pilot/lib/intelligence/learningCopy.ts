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
    return "Nausea tends to peak shortly after your dose. Today's plan is adjusted accordingly.";
  }

  // Within dose window AND recent titration.
  if (medication.recentTitration && symptoms.overallBurden !== "none") {
    return "Your body is adjusting to the new dose. Today's plan is lighter to support that transition.";
  }

  // Dose window nausea without titration.
  if (trends.doseDayPatternLikely && medication.daysSinceDose !== null && medication.daysSinceDose <= 2) {
    return "Nausea tends to peak shortly after your dose. Today's plan is adjusted accordingly.";
  }

  // GI elevated.
  if (symptoms.hasElevatedGI) {
    if (symptoms.overallBurden === "moderate") {
      return "GI symptoms are a bit elevated today. Plan items are lightened to match.";
    }
    return "GI symptoms are present. Rest, hydration, and bland foods are emphasized today.";
  }

  // Improving trend — positive reinforcement.
  if (
    trends.overallTrend === "improving" &&
    symptoms.overallBurden !== "none" &&
    engagement.engagementState !== "dropping"
  ) {
    return "Symptoms are trending better. Keep going.";
  }

  // Dropping engagement.
  if (engagement.engagementState === "dropping" && engagement.checkInStreak === 0) {
    return "Welcome back. Your plan is ready whenever you are.";
  }

  // Good streak.
  if (engagement.checkInStreak >= 7) {
    return `${engagement.checkInStreak} days of check-ins. Viva's plan is getting more precise.`;
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
    return "Recent dose changes can make symptoms more noticeable. This step uses gentle support.";
  }

  if (trends.doseDayPatternLikely && medication.daysSinceDose !== null && medication.daysSinceDose <= 2) {
    return "This intervention is timed to your typical post-dose pattern.";
  }

  if (medication.recentTitration) {
    return "A recent dose change means your body may need extra support right now.";
  }

  if (symptoms.hasElevatedGI && symptoms.nausea !== null && symptoms.nausea !== "none") {
    return "Nausea is elevated. This step targets GI comfort directly.";
  }

  if (symptoms.hasElevatedGI) {
    return "GI symptoms are elevated. This step is selected to ease digestive discomfort.";
  }

  if (trends.overallTrend === "improving") {
    return "Symptoms are trending better. This supports continued momentum.";
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
      return "Strong completion and improving symptoms. The plan is working.";
    }
    return "Symptoms are trending better this week.";
  }

  // High completion, stable symptoms.
  if (engagement.planCompletionRate7d >= 0.8 && symptoms.overallBurden !== "high") {
    return `${Math.round(engagement.planCompletionRate7d * 100)}% plan completion this week. Great consistency.`;
  }

  // Pattern: dose-day nausea recurring.
  if (trends.doseDayPatternLikely) {
    return "Nausea pattern linked to dose days. This week's plan accounts for that.";
  }

  // Wearable contributing.
  if (wearable.connected && ctx.dataConfidence === "high") {
    return "Sleep and activity data are informing this week's plan.";
  }

  // Recent dose change (settings-tracked) takes precedence over recentTitration flag.
  if (medication.doseChangedRecently) {
    return "You're adjusting to a recent dose change. This week's plan accounts for that.";
  }

  // Older recentTitration flag (set during onboarding).
  if (medication.recentTitration) {
    return "You're adjusting to a new dose. This week's plan is calibrated for that transition.";
  }

  // New to program.
  if (engagement.checkInStreak >= 1 && engagement.checkInStreak <= 7) {
    return "Early days. The plan will sharpen as you add more check-ins.";
  }

  // Low completion.
  if (engagement.planCompletionRate7d < 0.4 && engagement.checkInStreak > 0) {
    return "Fewer completions this week. Your plan adjusts automatically as you check in.";
  }

  return null;
}

// ---- buildPlanBannerLine ------------------------------------------------
// One sentence shown in the orange insight banner above the plan items.
// Explains WHY today's specific plan was generated — connecting patient
// context signals to the actual plan structure below the banner.
//
// Returns null when there is no meaningful specific signal to surface
// (the banner hides entirely in that case).

export type PlanDailyState = "recover" | "maintain" | "build" | "push";

export function buildPlanBannerLine(
  ctx: PatientIntelligenceContext,
  dailyState: PlanDailyState | null,
): string | null {
  if (!dailyState) return null;

  const { symptoms, trends, medication, wearable } = ctx;

  // Safety states: banner suppressed — other UI surfaces the urgent signal.
  if (
    symptoms.overallBurden === "severe" ||
    (symptoms.overallBurden === "high" && trends.nausea.direction === "worsening")
  )
    return null;

  // --- Strongest signals first ---

  // Nausea elevated: the primary driver of lighter/hydration-focused plans.
  if (symptoms.nausea === "severe" || symptoms.nausea === "moderate") {
    if (dailyState === "recover") {
      return "Today's plan prioritizes hydration and lighter pacing because nausea signals remain elevated.";
    }
    return "Today's plan is weighted toward hydration because nausea signals are elevated.";
  }

  // Recent dose change (settings-tracked): recovery and gentle support.
  if (medication.doseChangedRecently) {
    if (dailyState === "recover") {
      return "Recovery-focused support is prioritized after your recent dose change.";
    }
    return "Today's plan stays light and hydration-focused after your recent dose change.";
  }

  // GI symptoms (digestion, not just nausea).
  if (symptoms.hasElevatedGI) {
    return "Today's plan is weighted toward hydration and lighter fueling based on today's digestion signals.";
  }

  // Recent titration flag (set during onboarding — weaker than doseChangedRecently).
  if (medication.recentTitration && (dailyState === "recover" || dailyState === "maintain")) {
    return "Recovery and hydration are emphasized to support your body adjusting to the updated dose.";
  }

  // Low appetite: lighter fueling emphasis.
  if (symptoms.hasLowIntake) {
    return "Lower appetite signals shifted today's plan toward lighter fueling support.";
  }

  // Low energy + poor sleep: combined wearable + symptom signal.
  if (
    symptoms.hasLowEnergy &&
    wearable.connected &&
    (wearable.sleepTrend === "declining" || wearable.sleepTrend === "poor")
  ) {
    return "Recovery and hydration are prioritized because wearable recovery signals were lower today.";
  }

  // Low energy without wearable confirmation.
  if (symptoms.hasLowEnergy && dailyState === "recover") {
    return "Today's plan prioritizes recovery support based on low energy signals.";
  }

  // Wearable sleep signal alone.
  if (
    wearable.connected &&
    (wearable.sleepTrend === "declining" || wearable.sleepTrend === "poor") &&
    dailyState !== "build" &&
    dailyState !== "push"
  ) {
    return "Recovery is prioritized because sleep signals were lower today.";
  }

  // Dose-day pattern: nausea reliably spikes after dose.
  if (
    trends.doseDayPatternLikely &&
    medication.daysSinceDose !== null &&
    medication.daysSinceDose <= 2
  ) {
    return "Today's plan stays light and hydration-focused based on your dose day pattern.";
  }

  // Improving trend: acknowledge positive momentum without being generic.
  if (
    trends.overallTrend === "improving" &&
    symptoms.overallBurden !== "none" &&
    (dailyState === "maintain" || dailyState === "build")
  ) {
    return "Today's plan maintains gentle movement because symptoms improved after lower-burden pacing.";
  }

  // Good day with wearable data: acknowledge the data-driven plan.
  if (
    wearable.connected &&
    ctx.dataConfidence === "high" &&
    (dailyState === "build" || dailyState === "push") &&
    symptoms.overallBurden === "none"
  ) {
    return "Today's plan is built around strong wearable and check-in signals.";
  }

  // No meaningful specific signal — hide the banner.
  return null;
}



export function buildEngagementAck(
  ctx: PatientIntelligenceContext,
): string | null {
  const { engagement } = ctx;

  if (engagement.checkInStreak === 7) {
    return "One week of check-ins. Viva's plan is now meaningfully personalized.";
  }
  if (engagement.checkInStreak === 14) {
    return "Two weeks in. Your pattern data is helping Viva refine support timing.";
  }
  if (engagement.checkInStreak === 30) {
    return "30 days of check-ins. Viva has a clear picture of your treatment journey.";
  }

  if (engagement.planCompletionRate7d >= 0.9 && engagement.checkInStreak >= 5) {
    return "High consistency. You're giving Viva the data it needs.";
  }

  return null;
}
