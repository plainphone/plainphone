// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { client, unwrap } from "../api/client";
import type { Phone } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { usePhone } from "./PhoneContext";
import { Card, errorMessage, Switch, Text } from "./ui";

const preferences = [
  { key: "changeReceiptsEnabled", label: "health.receiptsToggle", help: "health.receiptsHelp" },
  { key: "healthBoardEnabled", label: "health.boardToggle", help: "health.boardHelp" },
] as const;

export function PhoneDisplayPreferences() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [saving, setSaving] = useState(false);
  if (phone.changeReceiptsEnabled === undefined && phone.healthBoardEnabled === undefined) return null;

  async function save(key: typeof preferences[number]["key"], enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await unwrap<Phone>(client.PATCH("/phones/{pid}", {
        params: { path: { pid: phone.id } },
        body: { [key]: enabled },
      })));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">{t("health.preferences")}</Text>
      {preferences.map(({ key, label, help }) => (
        <Switch
          key={key}
          label={t(label)}
          help={t(help)}
          value={phone[key] !== false}
          disabled={saving}
          onValueChange={(enabled) => void save(key, enabled)}
        />
      ))}
    </Card>
  );
}
