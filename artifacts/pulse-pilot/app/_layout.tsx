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
// Fade the native splash out over a short duration so it cross-fades into the
// JS screen instead of cutting. Combined with the onLayout gate below this
// eliminates the "brief Viva logo flash" reported from TestFlight.
try {
  SplashScreen.setOptions?.({ duration: 250, fade: true });
} catch {}

const queryClient = new QueryClient();

function SplashGate({ fontsReady, children }: { fontsReady: boolean; children: React.ReactNode }) {
  const { isLoading } = useApp();
  const ready = fontsReady && !isLoading;

  // Hide the native splash only AFTER the root view has actually laid out.
  // Using useEffect scheduled hideAsync before React had painted the first
  // frame of the JS tree, which let the tail of the native splash's dissolve
  // overlap with the blank app background -- the "flash" users saw. onLayout
  // fires after the real first paint, so the cross-fade lands on a rendered
  // screen, not on a gap.
  const onRootLayout = useCallback(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) return null;
  return (
    <View style={{ flex: 1 }} onLayout={onRootLayout}>
      {children}
    </View>
  );
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding/index" options={{ gestureEnabled: false }} />
      <Stack.Screen name="subscription" options={{ presentation: "modal" }} />
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
