import { Feather } from "@expo/vector-icons";
import { Stack, router } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, View, Text, StyleSheet, Pressable, Share, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { buildTierDebugSnapshot, type TierDebugSnapshot } from "@/lib/debug/buildTierDebugSnapshot";

/**
 * Dev-only QA screen. Renders the live tier classification, sufficiency / freshness gates,
 * usable metrics, fired negative signals, and current valid baselines. Gated on `__DEV__`
 * so production bundles bail with a "not available" message and never expose internals to
 * pilot users.
 */
export default function DevQaScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const {
    metrics, todayMetrics, availableMetricTypes, hasHealthData, dailyPlan,
    feeling, energy, stress, hydration, trainingIntent,
    glp1Energy, appetite, nausea, digestion,
  } = useApp();
  const [copied, setCopied] = useState(false);

  if (!__DEV__) {
    return (
      <View style={[styles.unavailable, { backgroundColor: c.background, paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ title: "QA", headerShown: false }} />
        <Text style={[styles.unavailableText, { color: c.text }]}>Not available in production builds.</Text>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: c.card }]}>
          <Text style={{ color: c.text }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const snapshot: TierDebugSnapshot = useMemo(() => buildTierDebugSnapshot({
    metrics,
    recentMetrics: metrics.slice(-14),
    todayMetrics,
    availableMetricTypes,
    hasHealthData,
    dailyPlan,
    wellnessInputs: { feeling, energy, stress, hydration, trainingIntent },
    glp1Inputs: { date: new Date().toISOString().split("T")[0], energy: glp1Energy, appetite, nausea, digestion },
  }), [metrics, todayMetrics, availableMetricTypes, hasHealthData, dailyPlan, feeling, energy, stress, hydration, trainingIntent, glp1Energy, appetite, nausea, digestion]);

  const json = JSON.stringify(snapshot, null, 2);

  const onShare = async () => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(json);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } else {
        await Share.share({ message: json });
      }
    } catch {
      // Best-effort; nothing to surface in QA.
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: "Dev QA", headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Feather name="chevron-left" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>Dev QA · Tier Debug</Text>
        <Pressable onPress={onShare} hitSlop={12} style={styles.headerBtn}>
          <Feather name={copied ? "check" : "share"} size={18} color={c.text} />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <DebugBanner color={c} />

        <Section title="Snapshot" color={c}>
          <Row k="generatedAt" v={snapshot.generatedAt} c={c} />
          <Row k="hasHealthData" v={String(snapshot.hasHealthData)} c={c} />
          <Row k="dataTier" v={snapshot.dataTier} highlight c={c} />
          <Row k="recommendationConfidence" v={snapshot.recommendationConfidence ?? "(none)"} highlight c={c} />
          <Row k="readiness" v={`${snapshot.readiness.score ?? "—"} (${snapshot.readiness.label ?? "—"}) · ${snapshot.readiness.state ?? "—"}`} c={c} />
        </Section>

        <Section title="Available metric types" color={c}>
          <Text style={[styles.value, { color: c.text }]}>
            {snapshot.availableMetricTypes.length > 0 ? snapshot.availableMetricTypes.join(", ") : "(none)"}
          </Text>
        </Section>

        <Section title="Sufficiency gates" color={c}>
          {Object.entries(snapshot.sufficiency).map(([k, v]) => (
            <Row key={k} k={k} v={String(v)} pass={typeof v === "boolean" ? v : undefined} c={c} />
          ))}
        </Section>

        <Section title="Freshness gates" color={c}>
          {Object.entries(snapshot.freshness).map(([k, v]) => (
            <Row key={k} k={k} v={String(v)} pass={v === true} c={c} />
          ))}
        </Section>

        <Section title="Usable metrics (sufficiency AND freshness)" color={c}>
          {Object.entries(snapshot.usable).map(([k, v]) => (
            <Row key={k} k={k} v={String(v)} pass={v} c={c} />
          ))}
        </Section>

        <Section title="Fired negative signals" color={c}>
          {snapshot.firedNegativeSignals.length === 0 ? (
            <Text style={[styles.value, { color: c.muted }]}>None</Text>
          ) : (
            snapshot.firedNegativeSignals.map(sig => (
              <View key={sig} style={[styles.signalChip, { backgroundColor: c.card, borderColor: c.border }]}>
                <Feather name="alert-triangle" size={12} color="#FF9500" />
                <Text style={[styles.signalText, { color: c.text }]}>{sig}</Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Baselines" color={c}>
          {Object.entries(snapshot.baselines).map(([k, v]) => (
            <Row key={k} k={k} v={v === null ? "(insufficient data)" : String(v)} pass={v !== null} c={c} />
          ))}
        </Section>

        <Section title="Valid baselines (sent to coach)" color={c}>
          {Object.entries(snapshot.validBaselines).map(([k, v]) => (
            <Row key={k} k={k} v={String(v)} pass={v} c={c} />
          ))}
        </Section>

        <Section title="Today vs baseline" color={c}>
          {Object.entries(snapshot.deviations).map(([k, v]) => (
            <Row key={k} k={k} v={v === null ? "—" : (typeof v === "number" ? v.toFixed(2) : String(v))} c={c} />
          ))}
        </Section>

        <Section title="Today snapshot" color={c}>
          {Object.entries(snapshot.todaySnapshot).map(([k, v]) => (
            <Row key={k} k={k} v={v === null ? "null" : String(v)} c={c} />
          ))}
        </Section>

        <Section title="History depth" color={c}>
          <Row k="totalDays" v={String(snapshot.historyDepth.totalDays)} c={c} />
          <Row k="oldest" v={snapshot.historyDepth.oldest ?? "—"} c={c} />
          <Row k="newest" v={snapshot.historyDepth.newest ?? "—"} c={c} />
        </Section>

        <Section title="Has subjective inputs" color={c}>
          <Row k="hasSubjectiveInputs" v={String(snapshot.hasSubjectiveInputs)} pass={snapshot.hasSubjectiveInputs} c={c} />
        </Section>
      </ScrollView>
    </View>
  );
}

function DebugBanner({ color }: { color: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.banner, { backgroundColor: "#FF950022", borderColor: "#FF9500" }]}>
      <Feather name="tool" size={14} color="#FF9500" />
      <Text style={[styles.bannerText, { color: color.text }]}>
        Dev-only diagnostics. Hidden in production builds.
      </Text>
    </View>
  );
}

function Section({ title, color, children }: { title: string; color: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { backgroundColor: color.card, borderColor: color.border }]}>
      <Text style={[styles.sectionTitle, { color: color.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ k, v, pass, highlight, c }: { k: string; v: string; pass?: boolean; highlight?: boolean; c: ReturnType<typeof useColors> }) {
  const dotColor = pass === undefined ? "transparent" : pass ? "#34C759" : "#FF453A";
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        {pass !== undefined && <View style={[styles.dot, { backgroundColor: dotColor }]} />}
        <Text style={[styles.key, { color: c.muted }]}>{k}</Text>
      </View>
      <Text style={[styles.value, { color: c.text, fontWeight: highlight ? "700" : "500" }]} numberOfLines={2}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  headerBtn: { padding: 4, minWidth: 30, alignItems: "center" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  bannerText: { fontSize: 12, fontWeight: "600" },
  section: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 4, gap: 12 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  key: { fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  value: { fontSize: 12, flexShrink: 1, textAlign: "right", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  signalChip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, marginBottom: 6 },
  signalText: { fontSize: 12, fontWeight: "600" },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  unavailableText: { fontSize: 16, textAlign: "center" },
  backBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
});
