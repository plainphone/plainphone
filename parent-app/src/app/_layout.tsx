// SPDX-License-Identifier: Apache-2.0
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { I18nProvider, useI18n } from "../i18n/I18n";
import { useNotificationRouting } from "../lib/notifications";
import { SessionProvider } from "../lib/session";
import { useColors } from "../lib/theme";

function AppStack() {
  const c = useColors();
  const { t } = useI18n();
  const scheme = useColorScheme();
  useNotificationRouting();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.accent,
          headerTitleStyle: { color: c.ink },
          headerShadowVisible: false,
          headerBackTitle: t("app.back"),
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: t("phones.title") }} />
        <Stack.Screen name="login" options={{ title: t("login.title"), headerShown: false }} />
        <Stack.Screen name="auth/app" options={{ title: t("callback.title"), headerShown: false }} />
        <Stack.Screen name="pair" options={{ title: t("pair.title") }} />
        <Stack.Screen name="invite" options={{ title: t("nav.household") }} />
        <Stack.Screen name="household" options={{ title: t("nav.household") }} />
        <Stack.Screen name="approvals" options={{ title: t("nav.approvals") }} />
        <Stack.Screen name="settings" options={{ title: t("native.settings") }} />
        <Stack.Screen name="phones/[pid]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <AppStack />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
