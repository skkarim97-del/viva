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
import { buildKeyInsights } from "@/lib/engine/trendsEngine";
import { useColors } from "@/hooks/useColors";
import type { MedicationProfile, MedicationLogEntry, AdaptiveInsight } from "@/types";

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

function weeksAgoDate(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function weekLabel(med: MedicationProfile): string {
  if (med.weekOnCurrentDose && med.weekOnCurrentDose > 0) {
    return `Week ${med.weekOnCurrentDose} on ${med.doseValue}${med.doseUnit}`;
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

function computeAdherenceLabel(
  log: MedicationLogEntry[],
  frequency: "weekly" | "daily",
  weekOnCurrentDose?: number,
): string | null {
  const window28ms = 28 * 86_400_000;
  const recent = log.filter(e => Date.now() - e.timestamp < window28ms);
  if (recent.length === 0) {
    return weekOnCurrentDose && weekOnCurrentDose > 0 ? "On track" : null;
  }
  const taken = recent.filter(e => e.status === "taken").length;
  const expected = frequency === "weekly" ? 4 : 28;
  return `${Math.min(100, Math.round((taken / expected) * 100))}%`;
}

function deriveSymptomStatus(
  insights: AdaptiveInsight[],
): "Improving" | "Stable" | "Managing" | null {
  if (insights.length === 0) return null;
  const hasTrendUp = insights.some(
    i => i.type === "trend" && /improv|better|easier|declin|reduc/i.test(i.text),
  );
  const hasPostDoseIssue = insights.some(
    i => i.type === "post_dose" && /peak|worsen|difficult|hard/i.test(i.text),
  );
  if (hasTrendUp) return "Improving";
  if (hasPostDoseIssue) return "Managing";
  return "Stable";
}

function insightLabel(insight: { type: string; text: string }): string {
  const t = insight.text.toLowerCase();
  if (/energy|fatigue|tired|depleted/.test(t)) return "Energy";
  if (/appetite|hunger|eating|food/.test(t)) return "Appetite";
  if (/nausea|sick|vomit/.test(t)) return "Nausea";
  if (/sleep|rest/.test(t)) return "Sleep";
  if (/weight|lb|pound|kg/.test(t)) return "Weight";
  if (/digest|stomach|bowel|constip|diarr/.test(t)) return "Digestion";
  if (/step|walk|activ|exercise|movement/.test(t)) return "Activity";
  if (/dose|inject|medic/.test(t)) return "Dose Timing";
  if (insight.type === "post_dose") return "After Dose";
  if (insight.type === "trend") return "Trend";
  if (insight.type === "correlation") return "Correlation";
  return "Insight";
}

function buildDemoTimeline(med: MedicationProfile): TimelineEvent[] {
  const BUCKET_WEEKS: Record<string, number> = {
    less_30_days: 3,
    "30_60_days": 7,
    "60_90_days": 11,
    "3_6_months": 18,
    "6_12_months": 30,
    "1_2_years": 60,
    "2_plus_years": 100,
  };
  const total = BUCKET_WEEKS[med.timeOnMedicationBucket] ?? 7;
  const events: TimelineEvent[] = [];

  events.push({
    date: weeksAgoDate(total),
    title: `Started ${med.medicationBrand} · 2.5mg`,
    tag: "Dose",
  });

  if (total >= 7) {
    events.push({
      date: weeksAgoDate(Math.round(total * 0.65)),
      title: "Appetite control improving",
      tag: "Progress",
    });
  }

  if (med.doseValue >= 5 && total >= 5) {
    events.push({
      date: weeksAgoDate(Math.round(total * 0.5)),
      title: `Increased to 5mg`,
      tag: "Dose",
    });
  }

  if (med.doseValue >= 7.5 && total >= 8) {
    events.push({
      date: weeksAgoDate(Math.round(total * 0.2)),
      title: `Increased to ${med.doseValue}${med.doseUnit}`,
      tag: "Dose",
    });
  }

  if (total >= 6) {
    events.push({
      date: weeksAgoDate(1),
      title: "Digestion symptoms improving",
      tag: "Progress",
    });
  }

  return events;
}

function buildTimeline(
  log: MedicationLogEntry[],
  insights: AdaptiveInsight[],
  med: MedicationProfile | undefined,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const sorted = [...log]
    .filter(e => e.status === "taken")
    .sort((a, b) => a.timestamp - b.timestamp);
  let lastDose: number | null = null;
  for (const entry of sorted) {
    if (entry.doseValue !== lastDose) {
      events.push({
        date: fmtDate(entry.date),
        title:
          lastDose === null
            ? `Started ${entry.doseValue}${entry.doseUnit}`
            : `Increased to ${entry.doseValue}${entry.doseUnit}`,
        tag: "Dose",
      });
      lastDose = entry.doseValue;
    }
  }

  for (const insight of insights) {
    if (insight.type === "trend") {
      events.push({ date: "Recently", title: insight.text, tag: "Progress" });
    }
  }

  if (events.length === 0 && med) {
    return buildDemoTimeline(med);
  }

  return events;
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
  const mergedInsights = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{
      id: string;
      text: string;
      type: "post_dose" | "correlation" | "trend" | "pattern" | "wearable";
    }> = [];
    for (const a of adaptiveInsights) {
      if (!seen.has(a.text)) {
        seen.add(a.text);
        result.push({ id: a.id, text: a.text, type: a.type });
      }
    }
    const supplement = [
      ...baseInsights,
      ...(inputAnalytics?.insights ?? []),
    ];
    for (const s of supplement) {
      if (!seen.has(s)) {
        seen.add(s);
        result.push({
          id: `wearable_${s.slice(0, 20)}`,
          text: s,
          type: "wearable",
        });
      }
    }
    return result.slice(0, 4);
  }, [adaptiveInsights, baseInsights, inputAnalytics]);

  const symptomStatus = useMemo(
    () => deriveSymptomStatus(adaptiveInsights),
    [adaptiveInsights],
  );
  const adherenceLabel = useMemo(
    () =>
      med
        ? computeAdherenceLabel(medicationLog, med.frequency, med.weekOnCurrentDose)
        : null,
    [medicationLog, med],
  );
  const riskLabel: "Low" | "Moderate" | null = useMemo(() => {
    if (!med) return null;
    const postDoseCount = adaptiveInsights.filter(i => i.type === "post_dose").length;
    return postDoseCount >= 3 ? "Moderate" : "Low";
  }, [adaptiveInsights, med]);

  const timeline = useMemo(
    () => buildTimeline(medicationLog, adaptiveInsights, med),
    [medicationLog, adaptiveInsights, med],
  );

  const hasSnapshotChips = !!(symptomStatus || adherenceLabel || riskLabel);

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
                {med.medicationBrand}
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
                      color={c.accent}
                    />
                  )}
                  {riskLabel && (
                    <ChipCard
                      label="Risk"
                      value={riskLabel}
                      color={riskLabel === "Low" ? "#34C759" : "#FF9500"}
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
            text="Your timeline will build as you check in."
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
    minWidth: 84,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
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
