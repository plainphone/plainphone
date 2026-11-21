// SPDX-License-Identifier: Apache-2.0
//
// "Ask for a callback" for one Child phone (docs/sos.md#asking-a-parent-to-call): the phone's own
// number, a parent's confirmation of it, and the switch. Same states and copy as the dashboard
// (web/src/components/CallbackSettings). The switch needs a confirmed number.
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { Button, Card, Field, Notice, Stack as VStack, Switch, Text } from "./ui";

export function CallbackSettings({ number, confirmed, enabled, saving, error, onSave, onSwitch }: {
  number: string | null;
  confirmed: boolean;
  enabled: boolean;
  saving: boolean;
  error: boolean;
  onSave: (number: string | null, confirmed: boolean) => Promise<void>;
  onSwitch: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const { callback } = useLocalSearchParams<{ callback?: string }>();
  const [open, setOpen] = useState(callback === "1");
  // "Open the settings" on a callback request lands here with the card open. Adjust during render
  // when the param changes (https://react.dev/learn/you-might-not-need-an-effect).
  const [seenCallback, setSeenCallback] = useState(callback);
  if (callback !== seenCallback) {
    setSeenCallback(callback);
    if (callback === "1") setOpen(true);
  }
  const [draft, setDraft] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const value = draft ?? number ?? "";
  const changed = draft !== null && draft.trim() !== (number ?? "");
  // A saved number nobody confirmed can be confirmed as it is.
  const canSave = !saving && sure && (changed ? draft.trim() !== "" : Boolean(number) && !confirmed);

  async function submit() {
    if (!canSave) return;
    await onSave(changed ? draft.trim() : number, true);
    setDraft(null);
    setSure(false);
  }

  return (
    <Card testID="callback-settings">
      <Button kind="plain" testID="callback-settings-toggle" title={t("cb.title")} onPress={() => setOpen(!open)} />
      {open ? (
        <VStack gap={12}>
          <Switch testID="callback-enabled" label={t("cb.title")} help={t("cb.help")} value={enabled}
            disabled={saving || !confirmed} onValueChange={onSwitch} />
          {!confirmed ? <Text variant="small">{number ? t("cb.unconfirmed") : t("cb.needNumber")}</Text> : null}
          <Field testID="callback-number" label={t("cb.number")} help={t("cb.numberHelp")} value={value}
            onChangeText={(text) => { setDraft(text); setSure(false); }}
            keyboardType="phone-pad" autoComplete="off" placeholder="+45" />
          <Switch testID="callback-confirm" label={t("cb.confirm")} value={sure} disabled={saving} onValueChange={setSure} />
          <Button testID="callback-save" title={t("cb.saveNumber")} busy={saving} disabled={!canSave} onPress={() => void submit()} />
          {number !== null && draft === null ? (
            <Button kind="plain" testID="callback-clear" title={t("app.remove")} disabled={saving} onPress={() => void onSave(null, false)} />
          ) : null}
          {error ? <Notice tone="warn" text={t("cb.error")} /> : null}
        </VStack>
      ) : null}
    </Card>
  );
}
