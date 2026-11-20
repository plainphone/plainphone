// SPDX-License-Identifier: Apache-2.0
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { I18nProvider, useI18n } from "../i18n/I18n";
import { useNotificationRouting } from "../lib/notifications";
import { SessionProvider, useSession } from "../lib/session";
import { useStackOptions } from "../lib/stackOptions";

function AppStack() {
  const options = useStackOptions();
  const { t } = useI18n();
  const scheme = useColorScheme();
  const { state } = useSession();
  useNotificationRouting(state.status);
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={options}>
        <Stack.Screen name="index" options={{ title: t("phones.title") }} />
        <Stack.Screen name="login" options={{ title: t("login.title"), headerShown: false }} />
        <Stack.Screen name="auth/app" options={{ title: t("callback.title"), headerShown: false }} />
        <Stack.Screen name="strong-setup" options={{ title: t("phoneLanguage.strong") }} />
        <Stack.Screen name="pair" options={{ title: t("pair.title") }} />
        <Stack.Screen name="invite" options={{ title: t("nav.household") }} />
        <Stack.Screen name="household" options={{ title: t("nav.household") }} />
        <Stack.Screen name="approvals" options={{ title: t("nav.approvals") }} />
        <Stack.Screen name="summary" options={{ title: t("summary.title") }} />
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
