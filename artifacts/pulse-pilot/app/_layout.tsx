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
  const ready = fontsReady && !isLoading;
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

function RootLayoutNav() {
  const { profile } = useApp();
  // Decide the initial route ONCE, before the Stack mounts. Previously the
  // app always mounted (tabs) first and then (tabs)/_layout did
  // <Redirect href="/onboarding" /> for fresh users -- that briefly mounted
  // and painted the tabs background before kicking back to onboarding,
  // producing a visible second jump. With initialRouteName the correct
  // first screen is the very first thing Expo Router renders.
  const initialRouteName = profile.onboardingComplete ? "(tabs)" : "onboarding/index";
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
            <AppProvider>
              <SplashGate fontsReady={fontsReady}>
                <RootLayoutNav />
              </SplashGate>
            </AppProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
