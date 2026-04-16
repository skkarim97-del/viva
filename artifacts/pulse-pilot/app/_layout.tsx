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
import React, { useCallback } from "react";
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

  // Two stacked rAFs ensure hideAsync fires AFTER React has actually
  // committed and painted the first frame of the children. onLayout alone
  // fires when the wrapper is measured, which can be one tick before the
  // child screen's pixels reach the GPU; that one-tick gap was the residual
  // "flash" surface even after the earlier onLayout fix.
  const onRootLayout = useCallback(() => {
    if (!ready) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
    });
  }, [ready]);

  // While we wait for fonts + persisted profile to hydrate, mount a solid
  // View painted in the splash background instead of returning null. The
  // native splash is still up at this moment so the user does not see this
  // View directly -- but if the OS hides the splash before we call
  // hideAsync (rare but possible on slow cold starts), the user sees the
  // same dark color underneath, NOT the iOS root window's default white.
  // This is what kills the residual "white flash + ghost logo" feel.
  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: LAUNCH_BG }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: LAUNCH_BG }} onLayout={onRootLayout}>
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
