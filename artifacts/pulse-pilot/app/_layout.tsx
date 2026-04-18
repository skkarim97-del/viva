import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  useFonts,
} from "@expo-google-fonts/montserrat";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppProvider, useApp } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import * as Linking from "expo-linking";
import { AppState, type AppStateStatus } from "react-native";
import { router } from "expo-router";
import { extractInviteToken } from "@/lib/api/sessionClient";
import { getRemindersEnabled, rescheduleReminders } from "@/lib/reminders";

SplashScreen.preventAutoHideAsync().catch(() => {});
// Fade the native splash out so it cross-fades into the JS screen instead of
// cutting. Combined with the matched-background scaffolding below this
// eliminates the "Viva logo flash" reported from TestFlight.
try {
  SplashScreen.setOptions?.({ duration: 220, fade: true });
} catch {}

// Single source of truth for the color that sits underneath the entire app
// during the launch handover. MUST exactly match `expo.splash.backgroundColor`
// in app.json. If the splash dissolves into a wrapper View painted in this
// same color, there is no perceived color change and therefore no perceived
// "ghost logo" frame as the splash fades out.
const LAUNCH_BG = "#0F1923";

const queryClient = new QueryClient();

function SplashGate({ fontsReady, children }: { fontsReady: boolean; children: React.ReactNode }) {
  const { isLoading } = useApp();
  const { loading: authLoading } = useAuth();
  const ready = fontsReady && !isLoading && !authLoading;
  const hiddenRef = useRef(false);

  const hideOnce = (reason: string) => {
    if (hiddenRef.current) return;
    hiddenRef.current = true;
    if (__DEV__) console.log("[SplashGate] hideAsync ->", reason);
    SplashScreen.hideAsync().catch(() => {});
  };

  // Defensive timeout: no matter what readiness signals do (or fail to do),
  // the native splash MUST come down within 3s of mount. This guarantees the
  // app can never deadlock on the Viva logo even if hydration hangs, fonts
  // fail to resolve, or the rAF chain below is starved.
  useEffect(() => {
    const t = setTimeout(() => hideOnce("timeout-3s"), 3000);
    return () => clearTimeout(t);
  }, []);

  // Hide the splash AFTER React has actually committed and painted the first
  // frame of the children. useEffect runs after commit; two stacked rAFs
  // wait for the next paint cycle so the splash dissolves into real pixels,
  // not a layout gap.
  //
  // IMPORTANT: this MUST be a useEffect keyed on `ready`, not an onLayout on
  // a shared wrapper View. The previous onLayout approach reused the same
  // <View> instance across the !ready/ready transition, so onLayout never
  // re-fired when the children mounted -- the splash stayed up forever.
  useEffect(() => {
    if (!ready) {
      if (__DEV__) console.log("[SplashGate] waiting", { fontsReady, isLoading });
      return;
    }
    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        hideOnce("ready+2raf");
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
    };
  }, [ready, fontsReady, isLoading]);

  // While not ready, paint a solid splash-colored View so any moment the OS
  // peeks behind the native splash shows the same dark color, not white.
  // Children are intentionally NOT mounted here -- they require hydrated
  // profile data (initialRouteName depends on profile.onboardingComplete).
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: LAUNCH_BG }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: LAUNCH_BG }}>
      {children}
    </View>
  );
}

// Listen for incoming deep links of the form viva://invite/<token> or
// https://viva-ai.replit.app/invite/<token>. Both shapes are handled
// here in JS rather than via a file-based [token] route because Expo
// Router on web can race the route discovery for nested dynamic
// segments on cold start, producing a "screen doesn't exist" 404. A
// listener is also closer to how the OS actually invokes the app from
// a tap on the email link.
function useInviteDeepLink() {
  useEffect(() => {
    const forward = (url: string | null) => {
      const tok = extractInviteToken(url ?? "");
      if (!tok) return;
      // replace() so the back stack starts at /connect, not at the raw
      // invite URL the OS handed us.
      router.replace({ pathname: "/connect", params: { token: tok } });
    };
    Linking.getInitialURL().then(forward).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => forward(e.url));
    return () => sub.remove();
  }, []);
}

// Drives the local check-in reminder schedule. Recomputes whenever the
// signed-in user changes, today's check-in lands, or the app comes
// back to the foreground. We re-read `hasCheckedInToday` straight from
// the AppContext value so the reminder logic and the dashboard "you've
// checked in" UI can never disagree.
function useReminderScheduler() {
  const { user } = useAuth();
  const { todayCheckIn } = useApp();
  const hasCheckedInToday = !!todayCheckIn;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const enabled = await getRemindersEnabled();
        if (cancelled) return;
        await rescheduleReminders({ enabled, hasCheckedInToday });
      } catch {
        /* notifications unsupported on this platform; no-op */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, hasCheckedInToday]);

  // Refresh the schedule when the app returns to the foreground. This
  // covers the "patient opened the app the next morning" case where
  // yesterday's reminders should be replaced with today's window.
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener("change", async (state: AppStateStatus) => {
      if (state !== "active") return;
      try {
        const enabled = await getRemindersEnabled();
        await rescheduleReminders({ enabled, hasCheckedInToday });
      } catch {
        /* no-op */
      }
    });
    return () => sub.remove();
  }, [user, hasCheckedInToday]);
}

function RootLayoutNav() {
  const { profile } = useApp();
  const { user } = useAuth();
  useInviteDeepLink();
  useReminderScheduler();
  // Auth gate decided ONCE at first render, same pattern as before:
  //   no session         -> /connect (paste invite or sign in)
  //   session, no profile-> /onboarding (local profile wizard)
  //   session + profile  -> (tabs)
  // The session token also unlocks the API: every check-in saved in
  // (tabs) mirrors to the backend so the doctor dashboard sees real
  // data instead of the patient's local-only AsyncStorage.
  const initialRouteName = !user
    ? "connect"
    : profile.onboardingComplete
      ? "(tabs)"
      : "onboarding/index";
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: LAUNCH_BG },
      }}
      initialRouteName={initialRouteName}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding/index" options={{ gestureEnabled: false }} />
      <Stack.Screen name="connect" options={{ gestureEnabled: false }} />
      <Stack.Screen name="metric-detail" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
  });

  const fontsReady = fontsLoaded || !!fontError;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <AuthProvider>
              <AppProvider>
                <SplashGate fontsReady={fontsReady}>
                  <RootLayoutNav />
                </SplashGate>
              </AppProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
