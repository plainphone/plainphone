// SPDX-License-Identifier: Apache-2.0
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import type { Locale } from "../api/models";
import { RequireAuth } from "../components/RequireAuth";
import { Button, Card, Choice, Notice, Screen, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { ServerChoice } from "../components/ServerChoice";
import { enablePush, pushState, type PushState } from "../lib/notifications";
import { useMe, useSession } from "../lib/session";

function Settings() {
  const { t, locale } = useI18n();
  const { saveLocale, logout } = useSession();
  const me = useMe();
  const router = useRouter();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushError, setPushError] = useState(false);

  useEffect(() => {
    let active = true;
    void pushState().then((result) => { if (active) setPush(result); }).catch(() => {
      if (active) {
        setPush("granted");
        setPushError(true);
      }
    });
    return () => { active = false; };
  }, []);

  return (
    <Screen testID="settings">
      <Card>
        <Text variant="small">{me.user.email}</Text>
        <Choice<Locale>
          label={t("nav.language")}
          value={locale}
          onChange={saveLocale}
          options={[
            { value: "en", label: "English" },
            { value: "da", label: "Dansk" },
          ]}
        />
      </Card>
      {push && push !== "unsupported" ? (
        <Card>
          <Text variant="heading">{t("native.notifications")}</Text>
          <Text variant="muted">{t("native.notificationsHelp")}</Text>
          {push === "registered" ? (
            <Notice tone="success" text={t("native.notificationsOn")} />
          ) : push === "denied" ? (
            <Notice tone="warn" text={t("native.notificationsOff")} />
          ) : (
            <Button
              kind="secondary"
              title={t("native.notificationsAsk")}
              busy={busy}
              onPress={() => {
                setBusy(true);
                setPushError(false);
                void enablePush(locale)
                  .then(setPush)
                  .catch(() => setPushError(true))
                  .finally(() => setBusy(false));
              }}
            />
          )}
          {pushError ? <Notice tone="error" text={t("native.pushRegistrationError")} /> : null}
        </Card>
      ) : null}
      <Card>
        <Text variant="heading">{t("native.server")}</Text>
        <ServerChoice signsOut />
        <Text variant="small">{t("native.version", { version: Constants.expoConfig?.version ?? "0" })}</Text>
      </Card>
      <Card>
        <Text variant="heading">{t("settings.freeTitle")}</Text>
        <Text>{t("settings.freePromise")}</Text>
      </Card>
      <Button
        kind="secondary"
        title={t("nav.logout")}
        testID="logout"
        onPress={() => void logout().then(() => router.replace("/login"))}
      />
    </Screen>
  );
}

export default function SettingsScreen() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}
