// SPDX-License-Identifier: Apache-2.0
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import type { Locale } from "../api/models";
import { RequireAuth } from "../components/RequireAuth";
import { Button, Card, Choice, Notice, Screen, Text } from "../components/ui";
import { languageNames, languages } from "../shared/lib/phone-language";
import { useI18n } from "../i18n/I18n";
import { SERVER_HOST } from "../lib/config";
import { enablePush, pushState, type PushState } from "../lib/notifications";
import { useMe, useSession } from "../lib/session";

function Settings() {
  const { t, locale } = useI18n();
  const { saveLocale, logout } = useSession();
  const me = useMe();
  const router = useRouter();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setPush).catch(() => setPush("unsupported"));
  }, []);

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
          {push === "granted" ? (
            <Notice tone="success" text={`${t("native.notificationsOn")} ${t("native.notificationsLater")}`} />
          ) : push === "denied" ? (
            <Notice tone="warn" text={t("native.notificationsOff")} />
          ) : (
            <Button
              kind="secondary"
              title={t("native.notificationsAsk")}
              busy={busy}
              onPress={() => {
                setBusy(true);
                void enablePush(locale)
                  .then((r) => setPush(r.state))
                  .finally(() => setBusy(false));
              }}
            />
          )}
        </Card>
      ) : null}
      <Card>
        <Text variant="heading">{t("native.server")}</Text>
        <Text variant="muted">{t("native.serverHelp", { host: SERVER_HOST })}</Text>
        <Text variant="small">{t("native.version", { version: Constants.expoConfig?.version ?? "0" })}</Text>
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
