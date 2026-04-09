import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppProvider } from "@/context/AppContext";

let KeyboardProviderComponent: React.ComponentType<{ children: React.ReactNode }> | null = null;
try {
  KeyboardProviderComponent = require("react-native-keyboard-controller").KeyboardProvider;
} catch {
  KeyboardProviderComponent = null;
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function KeyboardWrapper({ children }: { children: React.ReactNode }) {
  if (KeyboardProviderComponent) {
    return <KeyboardProviderComponent>{children}</KeyboardProviderComponent>;
  }
  return <>{children}</>;
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
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardWrapper>
              <AppProvider>
                <RootLayoutNav />
              </AppProvider>
            </KeyboardWrapper>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
