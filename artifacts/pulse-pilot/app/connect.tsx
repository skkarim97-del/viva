import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";

import colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { extractInviteToken, HttpError } from "@/lib/api/sessionClient";

type Mode = "activate" | "signin";

// First-launch gate. Two paths:
//   1. "I have an invite link" -> /auth/activate (set password, claim
//      the doctor-provisioned account, receive bearer token)
//   2. "I already have an account" -> /auth/login
// Either path ends with a stored bearer token and a populated AuthContext,
// after which RootLayout renders the rest of the app.
export default function ConnectScreen() {
  const { activate, signIn } = useAuth();
  // Deep-link prefill: viva://invite/<token> and the universal-link
  // equivalent both forward into /connect with ?token=<token>. We
  // accept the param as the initial value so the user just chooses a
  // password and taps Activate -- no copy-paste required.
  const params = useLocalSearchParams<{ token?: string }>();
  const initialToken = typeof params.token === "string" ? params.token : "";
  const [mode, setMode] = useState<Mode>("activate");
  const [link, setLink] = useState(initialToken);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === "activate") {
        const token = extractInviteToken(link);
        if (!token) {
          setError("Paste the invite link your clinician sent you.");
          return;
        }
        if (password.length < 8) {
          setError("Choose a password with at least 8 characters.");
          return;
        }
        await activate(token, password);
      } else {
        if (!email.includes("@") || password.length < 1) {
          setError("Enter your email and password.");
          return;
        }
        await signIn(email.trim().toLowerCase(), password);
      }
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 401) setError("Incorrect email or password.");
        else if (e.status === 404) setError("That invite link is not valid.");
        else if (e.status === 409)
          setError(
            "This invite has already been used. Sign in with your email instead.",
          );
        else setError("Something went wrong. Please try again.");
      } else {
        setError("Network error. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.brand}>VIVA</Text>
          <Text style={styles.title}>
            {mode === "activate"
              ? "Connect to your clinician"
              : "Sign in to Viva"}
          </Text>
          <Text style={styles.subtitle}>
            {mode === "activate"
              ? "Paste the invite link your clinician sent you, then choose a password."
              : "Use the email and password you set when activating your account."}
          </Text>

          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, mode === "activate" && styles.tabActive]}
              onPress={() => {
                setMode("activate");
                setError(null);
              }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  mode === "activate" && styles.tabLabelActive,
                ]}
              >
                I have an invite
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, mode === "signin" && styles.tabActive]}
              onPress={() => {
                setMode("signin");
                setError(null);
              }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  mode === "signin" && styles.tabLabelActive,
                ]}
              >
                Sign in
              </Text>
            </Pressable>
          </View>

          {mode === "activate" ? (
            <>
              <Text style={styles.label}>Invite link</Text>
              <TextInput
                style={styles.input}
                value={link}
                onChangeText={setLink}
                placeholder="https://viva-ai.replit.app/invite/..."
                placeholderTextColor={colors.light.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
              <Text style={styles.label}>Choose a password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                placeholderTextColor={colors.light.mutedForeground}
                secureTextEntry
                autoCapitalize="none"
              />
            </>
          ) : (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.light.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder=""
                secureTextEntry
                autoCapitalize="none"
              />
            </>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.cta, busy && { opacity: 0.6 }]}
            onPress={submit}
            disabled={busy}
          >
            <Text style={styles.ctaLabel}>
              {busy
                ? "Working..."
                : mode === "activate"
                  ? "Activate account"
                  : "Sign in"}
            </Text>
          </Pressable>

          <Text style={styles.helper}>
            Your clinician will only see the check-ins you submit through this
            app. You can sign out any time from Settings.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.light.background },
  scroll: { padding: 24, paddingBottom: 64 },
  brand: {
    fontFamily: "Montserrat_700Bold",
    fontSize: 22,
    letterSpacing: 4,
    color: colors.light.primary,
    marginBottom: 32,
  },
  title: {
    fontFamily: "Montserrat_700Bold",
    fontSize: 26,
    color: colors.light.foreground,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: "Montserrat_400Regular",
    fontSize: 15,
    lineHeight: 22,
    color: colors.light.mutedForeground,
    marginBottom: 24,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.light.muted,
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  tabActive: { backgroundColor: colors.light.background },
  tabLabel: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 14,
    color: colors.light.mutedForeground,
  },
  tabLabelActive: { color: colors.light.foreground },
  label: {
    fontFamily: "Montserrat_600SemiBold",
    fontSize: 13,
    color: colors.light.foreground,
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.light.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: "Montserrat_500Medium",
    fontSize: 15,
    color: colors.light.foreground,
    minHeight: 50,
  },
  error: {
    color: colors.light.destructive,
    fontFamily: "Montserrat_500Medium",
    fontSize: 14,
    marginTop: 16,
  },
  cta: {
    marginTop: 28,
    backgroundColor: colors.light.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaLabel: {
    fontFamily: "Montserrat_700Bold",
    fontSize: 16,
    color: colors.light.primaryForeground,
  },
  helper: {
    marginTop: 24,
    fontFamily: "Montserrat_400Regular",
    fontSize: 12,
    lineHeight: 18,
    color: colors.light.mutedForeground,
    textAlign: "center",
  },
});
