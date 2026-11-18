// SPDX-License-Identifier: Apache-2.0
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import type { Locale } from "../api/models";
import { RequireAuth } from "../components/RequireAuth";
import { Button, Card, Choice, Notice, Screen, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { SERVER_HOST } from "../lib/config";
import { enablePush, type PushState } from "../lib/notifications";
import { useMe, useSession } from "../lib/session";

function Settings() {
  const { t, locale } = useI18n();
  const { saveLocale, logout } = useSession();
  const me = useMe();
  const router = useRouter();
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    void enablePush(locale, false)
      .then((state) => { if (active) setPush(state); })
      .catch(() => { if (active) setPush("unavailable"); })
      .finally(() => { if (active) setBusy(false); });
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
          {push === "granted" ? (
            <Notice tone="success" text={t("native.notificationsOn")} />
          ) : push === "denied" ? (
            <Notice tone="warn" text={t("native.notificationsOff")} />
          ) : (
            <>
              {push === "unavailable" && <Notice tone="warn" text={t("native.notificationsUnavailable")} />}
              <Button
                kind="secondary"
                title={t("native.notificationsAsk")}
                busy={busy}
                onPress={() => {
                  setBusy(true);
                  void enablePush(locale)
                    .then(setPush)
                    .catch(() => setPush("unavailable"))
                    .finally(() => setBusy(false));
                }}
              />
            </>
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
        disabled={busy}
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
