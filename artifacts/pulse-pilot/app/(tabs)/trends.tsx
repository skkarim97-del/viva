import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useApp } from "@/context/AppContext";
import { computeHabitStats } from "@/data/insights";
import { scoreInput } from "@/data/inputScoring";
import { getBrandDisplayName, normalizeBrand as toBrandKey } from "@/data/medicationData";
import { buildKeyInsights } from "@/lib/engine/trendsEngine";
import { useColors } from "@/hooks/useColors";
import type {
  MedicationProfile,
  MedicationLogEntry,
  AdaptiveInsight,
  GLP1DailyInputs,
  CompletionRecord,
} from "@/types";

// ---------------------------------------------------------------- helpers

const TAG_COLORS = {
  Dose: "#38B6FF",
  Progress: "#34C759",
  Symptom: "#FF9500",
} as const;

type TagType = keyof typeof TAG_COLORS;

interface TimelineEvent {
  date: string;
  title: string;
  tag: TagType;
}

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Composite wellbeing score using nausea, digestion, and energy.
// Scale: 1 (worst) to 4 (best). Returns 0 when no data is present.
function symptomBurdenAvg(days: GLP1DailyInputs[]): number {
  const dayScores: number[] = [];
  for (const d of days) {
    const vals = [
      scoreInput("nausea", d),
      scoreInput("digestion", d),
      scoreInput("energy", d),
    ].filter(v => v > 0);
    if (vals.length > 0) {
      dayScores.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    }
  }
  return dayScores.length > 0
    ? dayScores.reduce((s, v) => s + v, 0) / dayScores.length
    : 0;
}

function displayBrand(name: string): string {
  const key = toBrandKey(name);
  if (key !== "other") return getBrandDisplayName(key);
  return name.trim().replace(/\b\w/g, c => c.toUpperCase()) || "Unknown";
}

function weekLabel(med: MedicationProfile): string {
  if (med.weekOnCurrentDose && med.weekOnCurrentDose > 0) {
    return `Week ${med.weekOnCurrentDose} on current dose`;
  }
  const MAP: Record<string, string> = {
    less_30_days: "Week 1–4 of treatment",
    "30_60_days": "Week 5–8 of treatment",
    "60_90_days": "Week 9–12 of treatment",
    "3_6_months": "Month 3–6 of treatment",
    "6_12_months": "Month 6–12 of treatment",
    "1_2_years": "Year 1–2 of treatment",
    "2_plus_years": "2+ years of treatment",
  };
  return MAP[med.timeOnMedicationBucket] ?? "In treatment";
}

// "Excellent" / "On track" / "Needs attention" based on medication
// log adherence combined with recent action completion rate.
function computeAdherenceLabel(
  log: MedicationLogEntry[],
  completionHistory: CompletionRecord[],
  frequency: "weekly" | "daily",
  weekOnCurrentDose?: number,
): string | null {
  const window28ms = 28 * 86_400_000;
  const recentLog = log.filter(e => Date.now() - e.timestamp < window28ms);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const recentCompletions = completionHistory.filter(r => new Date(r.date) >= cutoff);
  const avgCompletion = recentCompletions.length > 0
    ? recentCompletions.reduce((s, r) => s + r.completionRate, 0) / recentCompletions.length
    : null;

  if (recentLog.length === 0) {
    if (!(weekOnCurrentDose && weekOnCurrentDose > 0)) return null;
    if (avgCompletion !== null && avgCompletion >= 80) return "Excellent";
    if (avgCompletion !== null && avgCompletion < 40) return "Needs attention";
    return "On track";
  }

  const taken = recentLog.filter(e => e.status === "taken").length;
  const expected = frequency === "weekly" ? 4 : 28;
  const medRate = Math.min(100, Math.round((taken / expected) * 100));
  const overallRate = avgCompletion !== null
    ? Math.round((medRate + avgCompletion) / 2)
    : medRate;

  if (overallRate >= 85) return "Excellent";
  if (overallRate >= 55) return "On track";
  return "Needs attention";
}

// Derives symptom direction from GLP-1 check-in history only.
//   0–2 days  → "Stable" (insufficient data to infer direction)
//   3–6 days  → absolute burden score (< 2.5 = Managing)
//   7+ days   → compare recent 7d vs prior 7d period
function deriveSymptomStatus(
  glp1History: GLP1DailyInputs[],
): "Improving" | "Stable" | "Managing" {
  if (glp1History.length >= 7) {
    const recent = glp1History.slice(-7);
    const prior = glp1History.slice(-14, -7);
    const recentScore = symptomBurdenAvg(recent);

    if (prior.length >= 3) {
      const priorScore = symptomBurdenAvg(prior);
      if (recentScore > 0 && priorScore > 0) {
        if (recentScore - priorScore > 0.35) return "Improving";
        if (priorScore - recentScore > 0.35) return "Managing";
      }
    }
    if (recentScore > 0) return recentScore < 2.5 ? "Managing" : "Stable";
  } else if (glp1History.length >= 3) {
    const score = symptomBurdenAvg(glp1History);
    if (score > 0) return score < 2.5 ? "Managing" : "Stable";
  }

  // 0–2 days or no scoreable data: not enough history to infer direction
  return "Stable";
}

function insightLabel(insight: { type: string; text: string }): string {
  const t = insight.text.toLowerCase();
  if (/energy|fatigue|tired|depleted/.test(t)) return "Energy Pattern";
  if (/appetite|hunger|eating|food/.test(t)) return "Appetite Pattern";
  if (/nausea|sick|vomit/.test(t)) return "Nausea Pattern";
  if (/digest|stomach|bowel|constip|diarr/.test(t)) return "Digestion Pattern";
  if (/sleep|rest/.test(t)) return "Sleep Context";
  if (/step|walk|activ|exercise|movement/.test(t)) return "Activity Context";
  if (/dose|inject|medic/.test(t) || insight.type === "post_dose") return "Dose Response";
  if (/weight|lb|pound|kg/.test(t)) return "Weight Progress";
  if (/streak|complet|check.in|consistent/.test(t)) return "Check-in Pattern";
  if (insight.type === "trend" || insight.type === "correlation") return "Treatment Trend";
  return "Check-in Pattern";
}

// Builds timeline from real patient events only. Falls back to
// relative date labels when no start date or log exists.
function buildTimeline(
  log: MedicationLogEntry[],
  med: MedicationProfile | undefined,
  glp1History: GLP1DailyInputs[],
  completionHistory: CompletionRecord[],
): TimelineEvent[] {
  if (!med) return [];

  const events: TimelineEvent[] = [];
  const takenLog = [...log]
    .filter(e => e.status === "taken")
    .sort((a, b) => a.date.localeCompare(b.date));

  // 1. Started treatment
  const BUCKET_RELATIVE: Record<string, string> = {
    less_30_days: "~1 month ago",
    "30_60_days": "~2 months ago",
    "60_90_days": "~3 months ago",
    "3_6_months": "4–6 months ago",
    "6_12_months": "~9 months ago",
    "1_2_years": "~1 year ago",
    "2_plus_years": "2+ years ago",
  };

  if (med.startDate) {
    const startDose = takenLog.length > 0
      ? `${takenLog[0].doseValue}${takenLog[0].doseUnit}`
      : `${med.doseValue}${med.doseUnit}`;
    events.push({
      date: fmtDate(med.startDate),
      title: `Started ${displayBrand(med.medicationBrand)} · ${startDose}`,
      tag: "Dose",
    });
  } else if (takenLog.length > 0) {
    events.push({
      date: fmtDate(takenLog[0].date),
      title: `Started ${displayBrand(med.medicationBrand)} · ${takenLog[0].doseValue}${takenLog[0].doseUnit}`,
      tag: "Dose",
    });
  } else {
    events.push({
      date: BUCKET_RELATIVE[med.timeOnMedicationBucket] ?? "Earlier",
      title: `Started ${displayBrand(med.medicationBrand)} · ${med.doseValue}${med.doseUnit}`,
      tag: "Dose",
    });
  }

  // 2. Dose changes from medication log
  let prevDose = takenLog.length > 0 ? takenLog[0].doseValue : null;
  for (let i = 1; i < takenLog.length; i++) {
    const entry = takenLog[i];
    if (prevDose !== null && entry.doseValue !== prevDose) {
      events.push({
        date: fmtDate(entry.date),
        title: `Dose increased to ${entry.doseValue}${entry.doseUnit}`,
        tag: "Dose",
      });
    }
    prevDose = entry.doseValue;
  }

  // 3. Dynamic: symptom direction (requires 7+ days with a prior period)
  if (glp1History.length >= 7) {
    const recent = glp1History.slice(-7);
    const prior = glp1History.slice(-14, -7);
    if (prior.length >= 3) {
      const recentScore = symptomBurdenAvg(recent);
      const priorScore = symptomBurdenAvg(prior);
      if (recentScore > 0 && priorScore > 0) {
        if (recentScore - priorScore > 0.4) {
          events.push({ date: "Recently", title: "Symptoms trending better", tag: "Progress" });
        } else if (priorScore - recentScore > 0.4) {
          events.push({ date: "Recently", title: "Elevated symptom burden", tag: "Symptom" });
        }
      }
    }
  }

  // 4. Dynamic: adherence milestone (requires 5+ completions in last 7 days)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const recentCompletions = completionHistory.filter(r => new Date(r.date) >= cutoff);
  if (recentCompletions.length >= 5) {
    const avgRate = recentCompletions.reduce((s, r) => s + r.completionRate, 0) / recentCompletions.length;
    if (avgRate >= 75) {
      events.push({ date: "This week", title: "Strong plan adherence", tag: "Progress" });
    }
  }

  // Fixed-date events first (chronological), then relative strings
  const isRelative = (d: string) => /ago|Recently|week/i.test(d);
  return [
    ...events.filter(e => !isRelative(e.date)),
    ...events.filter(e => isRelative(e.date)),
  ].slice(0, 6);
}

// ---------------------------------------------------------------- sub-components

function EmptyState({ text, subtext }: { text: string; subtext: string }) {
  const c = useColors();
  return (
    <View style={emptyStyles.wrap}>
      <View style={[emptyStyles.iconWrap, { backgroundColor: c.accent + "12" }]}>
        <Feather name="clock" size={16} color={c.accent} />
      </View>
      <Text style={[emptyStyles.text, { color: c.foreground }]}>{text}</Text>
      <Text style={[emptyStyles.subtext, { color: c.mutedForeground }]}>{subtext}</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 24, gap: 8 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 14,
    fontFamily: "Montserrat_600SemiBold",
    textAlign: "center",
    letterSpacing: -0.1,
  },
  subtext: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    textAlign: "center",
    lineHeight: 20,
    opacity: 0.7,
    paddingHorizontal: 12,
  },
});

// ---------------------------------------------------------------- ChipCard

function ChipCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const c = useColors();
  return (
    <View style={[styles.chip, { backgroundColor: color + "10", borderColor: color + "28" }]}>
      <Text style={[styles.chipLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.chipValue, { color }]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- screen

export default function TrendsScreen() {
  const c = useColors();
  const {
    metrics,
    completionHistory,
    profile,
    medicationLog,
    inputAnalytics,
    hasHealthData,
    availableMetricTypes,
    adaptiveInsights,
    glp1InputHistory,
  } = useApp();

  const med = profile.medicationProfile;

  const habitStats = useMemo(
    () => computeHabitStats(completionHistory),
    [completionHistory],
  );
  const baseInsights = useMemo(
    () =>
      hasHealthData
        ? buildKeyInsights(metrics, habitStats, availableMetricTypes)
        : [],
    [metrics, habitStats, hasHealthData, availableMetricTypes],
  );

  // Merge insights: adaptive patterns first (always), then GLP-1 analytics
  // (always), then wearable signals (only when real data exists). Cap at 3.
  // Dedup by both text and derived category label.
  const mergedInsights = useMemo(() => {
    const seenText = new Set<string>();
    const seenCategory = new Set<string>();
    const result: Array<{
      id: string;
      text: string;
      type: "post_dose" | "correlation" | "trend" | "pattern" | "wearable";
    }> = [];

    const tryAdd = (id: string, text: string, type: typeof result[0]["type"]) => {
      if (result.length >= 3) return;
      if (seenText.has(text)) return;
      const cat = insightLabel({ type, text });
      if (seenCategory.has(cat)) return;
      seenText.add(text);
      seenCategory.add(cat);
      result.push({ id, text, type });
    };

    for (const a of adaptiveInsights) {
      tryAdd(a.id, a.text, a.type);
    }
    for (const s of (inputAnalytics?.insights ?? [])) {
      tryAdd(`analytics_${s.slice(0, 20)}`, s, "pattern");
    }
    if (hasHealthData) {
      for (const s of baseInsights) {
        tryAdd(`wearable_${s.slice(0, 20)}`, s, "wearable");
      }
    }

    return result;
  }, [adaptiveInsights, baseInsights, inputAnalytics, hasHealthData]);

  const symptomStatus = useMemo(
    () => med ? deriveSymptomStatus(glp1InputHistory) : null,
    [glp1InputHistory, med],
  );
  const adherenceLabel = useMemo(
    () =>
      med
        ? computeAdherenceLabel(medicationLog, completionHistory, med.frequency, med.weekOnCurrentDose)
        : null,
    [medicationLog, completionHistory, med],
  );

  const timeline = useMemo(
    () => buildTimeline(medicationLog, med, glp1InputHistory, completionHistory),
    [medicationLog, med, glp1InputHistory, completionHistory],
  );

  const hasSnapshotChips = !!(symptomStatus || adherenceLabel);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader />

      {/* ── Section 1: Treatment Snapshot (hero) ────────────── */}
      <View style={[styles.heroCard, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>
          Treatment Snapshot
        </Text>

        {med ? (
          <>
            <View style={styles.medBlock}>
              <Text style={[styles.medHeroName, { color: c.foreground }]}>
                {displayBrand(med.medicationBrand)}
              </Text>
              <Text style={[styles.medHeroDose, { color: c.mutedForeground }]}>
                {med.doseValue}{med.doseUnit} · {med.frequency}
              </Text>
              <Text style={[styles.medHeroWeek, { color: c.mutedForeground }]}>
                {weekLabel(med)}
              </Text>
            </View>

            {hasSnapshotChips && (
              <>
                <View style={styles.chipsRow}>
                  {symptomStatus && (
                    <ChipCard
                      label="Symptoms"
                      value={symptomStatus}
                      color={
                        symptomStatus === "Improving"
                          ? "#34C759"
                          : symptomStatus === "Managing"
                          ? "#FF9500"
                          : c.accent
                      }
                    />
                  )}
                  {adherenceLabel && (
                    <ChipCard
                      label="Adherence"
                      value={adherenceLabel}
                      color={
                        adherenceLabel === "Excellent"
                          ? "#34C759"
                          : adherenceLabel === "Needs attention"
                          ? "#FF9500"
                          : c.accent
                      }
                    />
                  )}
                </View>
                <Text style={[styles.sourceNote, { color: c.mutedForeground }]}>
                  Based on your recent check-ins and treatment history.
                </Text>
              </>
            )}
          </>
        ) : (
          <EmptyState
            text="Check in to personalize your plan."
            subtext="Viva will use your medication updates, symptoms and health signals to summarize your treatment progress."
          />
        )}
      </View>

      {/* ── Section 2: Treatment Insights ───────────────────── */}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>
            Treatment Insights
          </Text>
          <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>
            Patterns from your check-ins, medication timing and health signals.
          </Text>
        </View>

        {mergedInsights.length > 0 ? (
          <View style={styles.insightList}>
            {mergedInsights.map(insight => (
              <View key={insight.id} style={styles.insightRow}>
                <View style={[styles.insightDot, { backgroundColor: c.accent }]} />
                <View style={styles.insightContent}>
                  <Text style={[styles.insightCategory, { color: c.accent }]}>
                    {insightLabel(insight)}
                  </Text>
                  <Text style={[styles.insightText, { color: c.foreground }]}>
                    {insight.text}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            text="Complete a few check-ins so Viva can identify your treatment patterns."
            subtext="Your insights will connect symptoms, medication timing and health signals over time."
          />
        )}
      </View>

      {/* ── Section 3: Treatment Timeline ───────────────────── */}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: c.foreground }]}>
            Treatment Timeline
          </Text>
          <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>
            Key moments from your recent treatment journey.
          </Text>
        </View>

        {timeline.length > 0 ? (
          <View style={styles.timelineWrap}>
            {timeline.map((event, i) => {
              const tagColor = TAG_COLORS[event.tag];
              const isLast = i === timeline.length - 1;
              return (
                <View key={i} style={styles.timelineItem}>
                  <View style={styles.timelineLeft}>
                    <View style={[styles.timelineNode, { backgroundColor: tagColor }]} />
                    {!isLast && (
                      <View style={[styles.timelineLine, { backgroundColor: c.border }]} />
                    )}
                  </View>
                  <View style={[styles.timelineBody, isLast && styles.timelineBodyLast]}>
                    <View style={styles.timelineMetaRow}>
                      <Text style={[styles.timelineDate, { color: c.mutedForeground }]}>
                        {event.date}
                      </Text>
                      <View style={[styles.timelineTag, { backgroundColor: tagColor + "18" }]}>
                        <Text style={[styles.timelineTagText, { color: tagColor }]}>
                          {event.tag}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.timelineTitle, { color: c.foreground }]}>
                      {event.title}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            text="Your timeline will build as you log medication and check-ins."
            subtext="Viva will connect dose changes, symptoms and progress over time."
          />
        )}
      </View>

      <View style={{ height: 110 }} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------- styles

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
    gap: 16,
  },

  // Hero card (Treatment Snapshot) — more padding for visual dominance
  heroCard: {
    borderRadius: 22,
    padding: 24,
    gap: 16,
    shadowColor: "#142240",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },

  // Section cards (Insights, Timeline)
  card: {
    borderRadius: 20,
    padding: 20,
    gap: 14,
    shadowColor: "#142240",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  // Section header group (title + subtitle together)
  sectionHeader: {
    gap: 4,
  },

  sectionTitle: {
    fontSize: 17,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 19,
    opacity: 0.72,
  },

  // ── Treatment Snapshot hero ──────────────────────────────
  medBlock: {
    gap: 3,
    marginTop: 2,
  },
  medHeroName: {
    fontSize: 26,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.6,
    lineHeight: 30,
  },
  medHeroDose: {
    fontSize: 15,
    fontFamily: "Montserrat_500Medium",
    letterSpacing: -0.2,
    marginTop: 2,
  },
  medHeroWeek: {
    fontSize: 12,
    fontFamily: "Montserrat_400Regular",
    marginTop: 4,
    opacity: 0.7,
  },

  // Status chips
  chipsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  chip: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "flex-start",
    gap: 4,
  },
  chipLabel: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    opacity: 0.65,
  },
  chipValue: {
    fontSize: 16,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.3,
  },
  sourceNote: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    opacity: 0.55,
    fontStyle: "italic",
    marginTop: -4,
  },

  // ── Treatment Insights ───────────────────────────────────
  insightList: {
    gap: 14,
    marginTop: 2,
  },
  insightRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  insightDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
    flexShrink: 0,
  },
  insightContent: {
    flex: 1,
    gap: 2,
  },
  insightCategory: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  insightText: {
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 21,
  },

  // ── Treatment Timeline ───────────────────────────────────
  timelineWrap: {
    gap: 0,
    marginTop: 2,
  },
  timelineItem: {
    flexDirection: "row",
    gap: 14,
  },
  timelineLeft: {
    alignItems: "center",
    width: 18,
  },
  timelineNode: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
    flexShrink: 0,
  },
  timelineLine: {
    width: 1.5,
    flex: 1,
    marginTop: 4,
    marginBottom: -3,
    borderRadius: 1,
  },
  timelineBody: {
    flex: 1,
    paddingBottom: 22,
    gap: 5,
  },
  timelineBodyLast: {
    paddingBottom: 0,
  },
  timelineMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timelineDate: {
    fontSize: 13,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.1,
  },
  timelineTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  timelineTagText: {
    fontSize: 11,
    fontFamily: "Montserrat_600SemiBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  timelineTitle: {
    fontSize: 15,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 22,
    letterSpacing: -0.1,
  },
});
