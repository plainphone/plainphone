// SPDX-License-Identifier: Apache-2.0
//
// Hidden SOS and quick messages for one Child phone. Every option is a switch with one line of
// explanation. Same states and copy as the dashboard (web/src/components/SosOptions).
import { useState } from "react";
import { client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import { DEFAULT_SOS_SETTINGS, PRESS_CHOICES, type SosSettings } from "../shared/lib/sos-options";
import { FamilyInbox } from "./FamilyInbox";
import { QuickMessages } from "./QuickMessages";
import { Button, Card, Segmented, Stack as VStack, Switch, Text, useLoad } from "./ui";

export function SosOptions({ pid }: { pid: string }) {
  const { t } = useI18n();
  const params = { path: { pid } };
  const res = useLoad(() => unwrap<{ settings?: Partial<SosSettings> }>(client.GET("/phones/{pid}/sos", { params })), [pid]);
  const { setData } = res;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const settings: SosSettings = { ...DEFAULT_SOS_SETTINGS, ...res.data?.settings };

  async function save(patch: Partial<SosSettings>) {
    setSaving(true);
    setError(false);
    try {
      await unwrap(client.PUT("/phones/{pid}/sos", { params, body: patch }));
      setData((d) => d && { ...d, settings: { ...settings, ...patch } });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!res.data) return res.error ? <Text variant="small">{t("hidden.unavailable")}</Text> : null;
  const anyHidden = settings.hiddenPower || settings.hiddenClock;
  return (
    <>
      <Card testID="hidden-sos">
        <Button kind="plain" testID="hidden-sos-toggle" title={t("hidden.title")} onPress={() => setOpen(!open)} />
        {open ? (
          <VStack gap={12}>
            <Switch testID="hidden-power" label={t("hidden.power")} help={t("hidden.powerHelp")} value={settings.hiddenPower}
              disabled={saving} onValueChange={(on) => void save({ hiddenPower: on })} />
            {settings.hiddenPower ? (
              <VStack gap={8}>
                <Segmented<number> testID="hidden-presses" label={t("hidden.presses")} value={settings.hiddenPresses}
                  options={PRESS_CHOICES.map((n) => ({ value: n, label: String(n), testID: `hidden-presses-${n}` }))}
                  onChange={(n) => void save({ hiddenPresses: n as SosSettings["hiddenPresses"] })} />
                <Text variant="small">{t("hidden.pressesHelp")}</Text>
              </VStack>
            ) : null}
            <Switch testID="hidden-clock" label={t("hidden.clock")} help={t("hidden.clockHelp")} value={settings.hiddenClock}
              disabled={saving} onValueChange={(on) => void save({ hiddenClock: on })} />
            {anyHidden ? (
              <Segmented<"vibrate" | "none"> testID="hidden-feedback" label={t("hidden.feedback")} value={settings.hiddenFeedback}
                options={[
                  { value: "vibrate", label: t("hidden.vibrate"), testID: "hidden-feedback-vibrate" },
                  { value: "none", label: t("hidden.none"), testID: "hidden-feedback-none" },
                ]}
                onChange={(hiddenFeedback) => void save({ hiddenFeedback })} />
            ) : null}
            <Text variant="small">{t("hidden.visible")}</Text>
            {error ? <Text accessibilityRole="alert">{t("hidden.error")}</Text> : null}
          </VStack>
        ) : null}
      </Card>
      <QuickMessages pid={pid} settings={settings} saving={saving} onSetting={(patch) => void save(patch)} />
      <FamilyInbox pid={pid} settings={settings} saving={saving} onSetting={(patch) => void save(patch)} />
    </>
  );
}
