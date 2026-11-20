// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { client, unwrap } from "../api/client";
import type { Phone } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { appUpdateLines, type AppUpdateWindow } from "../shared/lib/app-updates";
import { usePhone } from "./PhoneContext";
import { Button, Card, errorMessage, Notice, Switch, Text } from "./ui";

/**
 * Strong mode: updates of approved apps (docs/policies.md, "App updates"). The nightly switch,
 * "Update apps now" and what the last window did. Same copy as the dashboard.
 */
export function AppUpdates() {
  const { t, locale } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [saving, setSaving] = useState(false);
  if (phone.mode !== "strong" || !phone.pairedAt) return null;
  const report = phone.status?.appUpdates as AppUpdateWindow | undefined;

  async function toggle(enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await unwrap<Phone>(client.PATCH("/phones/{pid}", {
        params: { path: { pid: phone.id } },
        body: { appUpdatesEnabled: enabled },
      })));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  async function updateNow() {
    setSaving(true);
    try {
      await unwrap(client.POST("/phones/{pid}/app-updates", { params: { path: { pid: phone.id } } }));
      notify({ tone: "success", text: t("appUpdates.requested") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">{t("appUpdates.title")}</Text>
      <Switch
        label={t("appUpdates.switch")}
        help={t("appUpdates.help")}
        value={phone.appUpdatesEnabled !== false}
        disabled={saving}
        onValueChange={(enabled) => void toggle(enabled)}
      />
      {appUpdateLines(report, locale).map((line) =>
        line.tone === "warn"
          ? <Notice key={line.key} tone="warn" text={t(line.key, line.params)} />
          : <Text key={line.key} variant="muted">{t(line.key, line.params)}</Text>)}
      <Button kind="secondary" title={t("appUpdates.now")} busy={saving} onPress={() => void updateNow()} />
    </Card>
  );
}
