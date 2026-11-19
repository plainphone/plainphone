// SPDX-License-Identifier: Apache-2.0
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import type { Locale } from "../api/models";
import { RequireAuth } from "../components/RequireAuth";
import { Button, Card, Choice, Notice, Screen, Text } from "../components/ui";
import { languageNames, languages } from "../shared/lib/phone-language";
import { useI18n } from "../i18n/I18n";
import { ServerChoice } from "../components/ServerChoice";
import { WeeklySummarySettings } from "../components/WeeklySummarySettings";
import { syncNativePush, type PushState } from "../lib/notifications";
import { useMe, useSession } from "../lib/session";

function Settings() {
  const { t, locale } = useI18n();
  const { saveLocale, logout } = useSession();
  const me = useMe();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void syncNativePush(locale).then((state) => { if (active) setPush(state); });
    return () => { active = false; };
  }, [locale]);

  return (
    <Screen testID="settings">
      <Card>
        <Text variant="small">{me.user.email}</Text>
        <Choice<Locale>
          label={t("nav.language")}
          value={locale}
          onChange={saveLocale}
          options={languages.map((value) => ({ value, label: languageNames[value] }))}
        />
      </Card>
      {push && push !== "unsupported" ? (
        <Card>
          <Text variant="heading">{t("native.notifications")}</Text>
          <Text variant="muted">{t("native.notificationsHelp")}</Text>
          <Text variant="muted">{t("sos.dnd")}</Text>
          {push === "granted" ? (
            <Notice tone="success" text={t("native.notificationsOn")} />
          ) : push === "unavailable" ? (
            <Notice tone="warn" text={t("native.notificationsUnavailable")} />
          ) : push === "denied" ? (
            <Notice tone="warn" text={t("native.notificationsOff")} />
          ) : (
            <Button
              kind="secondary"
              title={t("native.notificationsAsk")}
              busy={busy}
              onPress={() => {
                setBusy(true);
                void syncNativePush(locale, true)
                  .then(setPush)
                  .finally(() => setBusy(false));
              }}
            />
          )}
        </Card>
      ) : null}
      <WeeklySummarySettings />
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
        onPress={() => void logout()}
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
