import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { sessionApi, HttpError } from "@/lib/api/sessionClient";

interface WeightLogModalProps {
  visible: boolean;
  // null when the patient has never logged a weight; days (>= 0) when
  // we're showing the weekly nudge so the copy can reflect cadence.
  daysSinceLast: number | null;
  // Pre-fill the input with the most recent value to make tweaking
  // quick (most weeks the number barely moves).
  initialValue?: number | null;
  onClose: () => void;
  // Fires after a successful POST so the caller can refetch latest /
  // update its banner state without re-opening the modal.
  onLogged: (weightLbs: number) => void;
}

export default function WeightLogModal({
  visible,
  daysSinceLast,
  initialValue,
  onClose,
  onLogged,
}: WeightLogModalProps) {
  const c = useColors();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValue(initialValue != null ? String(Math.round(initialValue)) : "");
      setError(null);
      setSubmitting(false);
    }
  }, [visible, initialValue]);

  const headline =
    daysSinceLast === null
      ? "Log your weight"
      : daysSinceLast >= 7
      ? "Time for your weekly weigh-in"
      : "Update your weight";

  const sub =
    daysSinceLast === null
      ? "We'll check in once a week so your clinician can track progress."
      : daysSinceLast >= 7
      ? `It's been ${daysSinceLast} days since your last entry.`
      : "Quick update -- takes a second.";

  const handleSubmit = async () => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 40 || num > 900) {
      setError("Enter a weight between 40 and 900 lbs.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await sessionApi.logWeight(num);
      onLogged(num);
      onClose();
    } catch (e) {
      const msg =
        e instanceof HttpError && e.status === 401
          ? "Please sign in again."
          : "Couldn't save. Try again in a moment.";
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.header}>
            <View
              style={[
                styles.iconBubble,
                { backgroundColor: c.muted },
              ]}
            >
              <Feather name="trending-down" size={18} color={c.foreground} />
            </View>
            <Pressable
              accessibilityLabel="Dismiss"
              onPress={onClose}
              hitSlop={12}
              style={styles.close}
            >
              <Feather name="x" size={20} color={c.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.title, { color: c.foreground }]}>{headline}</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>{sub}</Text>

          <View
            style={[
              styles.inputRow,
              { backgroundColor: c.muted, borderColor: c.border },
            ]}
          >
            <TextInput
              value={value}
              onChangeText={(t) => {
                setValue(t.replace(/[^0-9.]/g, ""));
                if (error) setError(null);
              }}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={c.mutedForeground}
              style={[styles.input, { color: c.foreground }]}
              autoFocus
              maxLength={5}
            />
            <Text style={[styles.unit, { color: c.mutedForeground }]}>lbs</Text>
          </View>

          {error ? (
            <Text style={[styles.error, { color: c.destructive }]}>{error}</Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              disabled={submitting}
              style={[
                styles.btn,
                styles.btnGhost,
                { borderColor: c.border },
              ]}
            >
              <Text style={[styles.btnGhostText, { color: c.mutedForeground }]}>
                Not now
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={submitting || !value}
              style={[
                styles.btn,
                styles.btnPrimary,
                {
                  backgroundColor: c.foreground,
                  opacity: submitting || !value ? 0.5 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={c.background} size="small" />
              ) : (
                <Text style={[styles.btnPrimaryText, { color: c.background }]}>
                  Save
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  close: { padding: 4 },
  title: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 18,
    marginBottom: 6,
  },
  sub: {
    fontFamily: "Montserrat_400Regular",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  input: {
    flex: 1,
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 28,
    paddingVertical: 10,
  },
  unit: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 14,
    marginLeft: 8,
  },
  error: {
    fontFamily: "Montserrat_500Medium",
    fontSize: 12,
    marginTop: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: { borderWidth: 1 },
  btnGhostText: { fontFamily: "Montserrat_500Medium", fontSize: 14 },
  btnPrimary: {},
  btnPrimaryText: { fontFamily: "Montserrat_600SemiBold", fontSize: 14 },
});
