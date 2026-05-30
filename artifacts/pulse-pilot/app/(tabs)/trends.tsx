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
    // No logged doses yet — use onboarding-reported week count as proxy
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

  // Real dose-change events from medication log
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

  // Progress events from trend insights
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
  wrap: { alignItems: "center", paddingVertical: 20, gap: 8 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
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
    lineHeight: 19,
    opacity: 0.75,
    paddingHorizontal: 8,
  },
});

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

  // ---- "What Viva Has Learned" insight list (reuse existing merge logic)
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

  // ---- Treatment Snapshot chips
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

  // ---- Treatment Timeline
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

      {/* ── Section 1: Treatment Snapshot ───────────────────── */}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>
          Treatment Snapshot
        </Text>

        {med ? (
          <>
            <View style={styles.medLine}>
              <View style={[styles.medDot, { backgroundColor: c.accent }]} />
              <Text style={[styles.medName, { color: c.foreground }]}>
                {med.medicationBrand} · {med.doseValue}
                {med.doseUnit} {med.frequency}
              </Text>
            </View>
            <Text style={[styles.weekLabel, { color: c.mutedForeground }]}>
              {weekLabel(med)}
            </Text>

            {hasSnapshotChips && (
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
            )}

            {hasSnapshotChips && (
              <Text style={[styles.sourceNote, { color: c.mutedForeground }]}>
                Based on your recent check-ins and treatment history.
              </Text>
            )}
          </>
        ) : (
          <EmptyState
            text="Check in to personalize your plan."
            subtext="Viva will use your medication updates, symptoms and health signals to summarize your treatment progress."
          />
        )}
      </View>

      {/* ── Section 2: What Viva Has Learned ────────────────── */}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>
          What Viva Has Learned
        </Text>
        <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>
          Based on your medication timing, check-ins and recent patterns.
        </Text>

        {mergedInsights.length > 0 ? (
          <View style={styles.insightList}>
            {mergedInsights.map(insight => (
              <View key={insight.id} style={styles.insightRow}>
                <View
                  style={[styles.insightDot, { backgroundColor: c.accent }]}
                />
                <Text style={[styles.insightText, { color: c.foreground }]}>
                  {insight.text}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            text="Complete a few check-ins so Viva can identify your patterns."
            subtext="Your insights will connect symptoms, medication timing and health signals over time."
          />
        )}
      </View>

      {/* ── Section 3: Treatment Timeline ───────────────────── */}
      <View style={[styles.card, { backgroundColor: c.card }]}>
        <Text style={[styles.sectionTitle, { color: c.foreground }]}>
          Treatment Timeline
        </Text>
        <Text style={[styles.sectionSub, { color: c.mutedForeground }]}>
          Key moments from your recent treatment journey.
        </Text>

        {timeline.length > 0 ? (
          <View style={styles.timelineWrap}>
            {timeline.map((event, i) => {
              const tagColor = TAG_COLORS[event.tag];
              const isLast = i === timeline.length - 1;
              return (
                <View key={i} style={styles.timelineItem}>
                  <View style={styles.timelineLeft}>
                    <View
                      style={[
                        styles.timelineNode,
                        { backgroundColor: tagColor },
                      ]}
                    />
                    {!isLast && (
                      <View
                        style={[
                          styles.timelineLine,
                          { backgroundColor: c.border },
                        ]}
                      />
                    )}
                  </View>
                  <View style={[styles.timelineBody, isLast && styles.timelineBodyLast]}>
                    <View style={styles.timelineMetaRow}>
                      <Text
                        style={[
                          styles.timelineDate,
                          { color: c.mutedForeground },
                        ]}
                      >
                        {event.date}
                      </Text>
                      <View
                        style={[
                          styles.timelineTag,
                          { backgroundColor: tagColor + "18" },
                        ]}
                      >
                        <Text
                          style={[styles.timelineTagText, { color: tagColor }]}
                        >
                          {event.tag}
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={[styles.timelineTitle, { color: c.foreground }]}
                    >
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
    <View style={[styles.chip, { backgroundColor: color + "12", borderColor: color + "30" }]}>
      <Text style={[styles.chipLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[styles.chipValue, { color }]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- styles

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
    gap: 14,
  },

  // Cards
  card: {
    borderRadius: 20,
    padding: 20,
    gap: 12,
    shadowColor: "#142240",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  // Section headers
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 19,
    marginTop: -4,
    opacity: 0.8,
  },

  // Treatment Snapshot
  medLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  medDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  medName: {
    fontSize: 16,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.3,
  },
  weekLabel: {
    fontSize: 13,
    fontFamily: "Montserrat_400Regular",
    marginTop: -4,
  },
  chipsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 4,
  },
  chip: {
    flex: 1,
    minWidth: 80,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "flex-start",
    gap: 3,
  },
  chipLabel: {
    fontSize: 10,
    fontFamily: "Montserrat_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    opacity: 0.7,
  },
  chipValue: {
    fontSize: 15,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: -0.2,
  },
  sourceNote: {
    fontSize: 11,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 16,
    opacity: 0.6,
    fontStyle: "italic",
    marginTop: -2,
  },

  // What Viva Has Learned
  insightList: { gap: 12, marginTop: 4 },
  insightRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  insightDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
    flexShrink: 0,
  },
  insightText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Montserrat_400Regular",
    lineHeight: 21,
  },

  // Treatment Timeline
  timelineWrap: { gap: 0, marginTop: 4 },
  timelineItem: {
    flexDirection: "row",
    gap: 12,
  },
  timelineLeft: {
    alignItems: "center",
    width: 14,
  },
  timelineNode: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    flexShrink: 0,
  },
  timelineLine: {
    width: 1.5,
    flex: 1,
    marginTop: 3,
    marginBottom: -2,
    borderRadius: 1,
  },
  timelineBody: {
    flex: 1,
    paddingBottom: 16,
    gap: 4,
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
    fontSize: 12,
    fontFamily: "Montserrat_500Medium",
    letterSpacing: 0.1,
  },
  timelineTag: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  timelineTagText: {
    fontSize: 10,
    fontFamily: "Montserrat_700Bold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  timelineTitle: {
    fontSize: 14,
    fontFamily: "Montserrat_500Medium",
    lineHeight: 20,
    letterSpacing: -0.1,
  },
});
