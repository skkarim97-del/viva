import React, { useState } from "react";
import {
  Image,
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
import { router, useLocalSearchParams } from "expo-router";

import colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";
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
  const { activate, signIn, devDemoLogin } = useAuth();
  // Dev login bypasses the local onboarding wizard so the operator
  // lands directly on Today. We need updateProfile from AppContext to
  // flip onboardingComplete the same way the wizard's Done button does.
  const { updateProfile } = useApp();
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
        else if (e.status === 410)
          // 410 Gone = TTL exceeded. The link itself was real but the
          // window for using it has closed. Direct them at the doctor
          // for a fresh one rather than implying the link is malformed.
          setError(
            "This invite link has expired. Ask your clinician to send you a fresh one.",
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
          <Image
            source={require("@/assets/viva-wordmark-navy.png")}
            style={styles.brand}
            resizeMode="contain"
            accessibilityLabel="Viva"
          />

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

          {/*
            Replit-preview-only convenience login. Gated on __DEV__ so
            the entire button (label, handler, divider, helper text)
            tree-shakes out of production bundles. Tapping it hits
            /api/dev/login-demo-patient, stores the returned bearer
            token in AsyncStorage under the same key normal sign-in
            uses, and lets RootLayoutNav redirect into (tabs) once the
            user state lands. The endpoint itself is also gated server-
            side; if a production API somehow receives the call the
            button surfaces a clear "not available" error.
          */}
          {__DEV__ && (
            <>
              <View style={styles.devDivider}>
                <View style={styles.devDividerLine} />
                <Text style={styles.devDividerLabel}>DEV ONLY</Text>
                <View style={styles.devDividerLine} />
              </View>
              <Pressable
                style={[styles.devCta, busy && { opacity: 0.6 }]}
                onPress={async () => {
                  setError(null);
                  setBusy(true);
                  try {
                    await devDemoLogin();
                    // Mark the local onboarding wizard as complete so
                    // RootLayoutNav's gate routes the demo session into
                    // (tabs) instead of /onboarding/index. Without this
                    // a fresh device with no AsyncStorage profile would
                    // bounce through the multi-step wizard before ever
                    // reaching Today.
                    updateProfile({ onboardingComplete: true });
                    // Expo Router's <Stack initialRouteName=...> only
                    // applies to the FIRST mount; toggling user state
                    // post-mount does NOT auto-navigate. The normal
                    // sign-in path lives with this because operators
                    // rarely cold-start at /connect after authenticating;
                    // the dev shortcut needs explicit replace() so the
                    // tester sees Today immediately.
                    router.replace("/(tabs)");
                  } catch (e) {
                    if (e instanceof HttpError && e.status === 404) {
                      setError(
                        "Demo login is not available on this server.",
                      );
                    } else {
                      setError(
                        "Demo login failed. Check the API server logs.",
                      );
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                <Text style={styles.devCtaLabel}>
                  {busy ? "Working..." : "Login as Demo Patient"}
                </Text>
              </Pressable>
              <Text style={styles.devHelper}>
                Replit preview only. Skips invite + password and lands
                you in the Today tab as a seeded fake patient.
              </Text>
            </>
          )}

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
    width: 96,
    height: 44,
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
  devDivider: {
    marginTop: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  devDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.light.border,
  },
  devDividerLabel: {
    fontFamily: "Montserrat_700Bold",
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.light.mutedForeground,
  },
  devCta: {
    marginTop: 16,
    backgroundColor: "#F59E0B",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  devCtaLabel: {
    fontFamily: "Montserrat_700Bold",
    fontSize: 16,
    color: "#1F2937",
  },
  devHelper: {
    marginTop: 10,
    fontFamily: "Montserrat_400Regular",
    fontSize: 12,
    lineHeight: 17,
    color: colors.light.mutedForeground,
    textAlign: "center",
  },
});
