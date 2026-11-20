// SPDX-License-Identifier: Apache-2.0
//
// Emergency openings of a Self phone: the key screen's section (switch, openings per month,
// this month's use, history) and the compact block under each person in the helper's list.
import { useState } from "react";
import { View } from "react-native";
import { client, unwrap } from "../api/client";
import type { ChangeResult, EmergencyOpening, EmergencyOpenings, EmergencySettings } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { space } from "../lib/theme";
import { formatDateTime } from "../shared/lib/format";
import { Button, LoadGate, Segmented, Stack as VStack, Switch, Text, useLoad } from "./ui";
import { usePhone } from "./PhoneContext";

const ALLOWANCES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function OpeningLines({ openings, withMinutes, testID }: { openings: EmergencyOpening[]; withMinutes: boolean; testID?: string }) {
  const { t, locale } = useI18n();
  return (
    <VStack gap={6}>
      {openings.map((o) => {
        const line = t("emergency.openingLine", { app: o.appLabel || o.packageName, time: formatDateTime(o.openedAt, locale) });
        return (
          <Text key={o.id} testID={testID} variant="small">
            {withMinutes ? `${line} · ${t("emergency.minutes", { n: o.minutes })}` : line}
          </Text>
        );
      })}
    </VStack>
  );
}

/** The key screen's section. Light-mode phones only; a strong-mode phone gets one honest line. */
export function EmergencySection() {
  const { t } = useI18n();
  const { phone } = usePhone();
  return (
    <View testID="emergency-section" style={{ gap: space.md }}>
      <Text variant="heading" accessibilityRole="header">{t("emergency.title")}</Text>
      {phone.mode === "light" ? <EmergencyLoader /> : <Text variant="small">{t("emergency.lightOnly")}</Text>}
    </View>
  );
}

function EmergencyLoader() {
  const { phone } = usePhone();
  const res = useLoad(
    () => unwrap<EmergencyOpenings>(client.GET("/phones/{pid}/emergency-openings", { params: { path: { pid: phone.id } } })),
    [phone.id],
  );
  return (
    <LoadGate res={res}>
      {(data) => (
        // New saved values from the server start the form afresh.
        <EmergencyForm key={`${data.enabled}/${data.allowance}/${data.used.count}`} data={data} onSaved={() => void res.reload()} />
      )}
    </LoadGate>
  );
}

function EmergencyForm({ data, onSaved }: { data: EmergencyOpenings; onSaved: () => void }) {
  const { t } = useI18n();
  const { phone, run } = usePhone();
  const [enabled, setEnabled] = useState(data.enabled);
  const [allowance, setAllowance] = useState(data.allowance);
  const [saving, setSaving] = useState(false);

  const dirty = enabled !== data.enabled || allowance !== data.allowance;

  async function save() {
    setSaving(true);
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(
            client.PUT("/phones/{pid}/emergency-openings", { params: { path: { pid: phone.id } }, body: { enabled, allowance } }),
          ),
        t("app.saved"),
      );
      if (r?.status === "applied") onSaved();
      else {
        // Waiting for the key (or failed): show the saved values again, not the loosened ones.
        setEnabled(data.enabled);
        setAllowance(data.allowance);
      }
    } catch {
      setEnabled(data.enabled);
      setAllowance(data.allowance);
    } finally {
      setSaving(false);
    }
  }

  return (
    <VStack>
      <Switch testID="emergency-switch" label={t("emergency.switch")} help={t("emergency.help")} value={enabled} onValueChange={setEnabled} disabled={saving} />
      {enabled ? (
        <Segmented<number>
          testID="emergency-allowance"
          label={t("emergency.allowance")}
          value={allowance}
          onChange={setAllowance}
          options={ALLOWANCES.map((n) => ({ value: n, label: String(n), testID: `emergency-allowance-${n}` }))}
        />
      ) : null}
      <Text variant="small">{t("key.looseningNote")}</Text>
      <Button testID="emergency-save" title={saving ? t("app.saving") : t("app.save")} busy={saving} disabled={!dirty} onPress={() => void save()} />
      <Text testID="emergency-used">{t("emergency.used", { used: data.used.count, total: data.allowance })}</Text>
      <Text variant="label">{t("emergency.history")}</Text>
      {data.openings.length === 0 ? (
        <Text variant="muted" testID="emergency-none">{t("emergency.none")}</Text>
      ) : (
        <OpeningLines openings={data.openings} withMinutes testID="emergency-opening" />
      )}
    </VStack>
  );
}

/** A compact block under a person in "People I help". Nothing when the server did not send it. */
export function EmergencyBlock({ emergency }: { emergency?: (EmergencySettings & { openings?: EmergencyOpening[] }) | null }) {
  const { t } = useI18n();
  if (!emergency) return null;
  const openings = emergency.openings ?? [];
  return (
    <View testID="emergency-block" style={{ gap: 6 }}>
      <Text variant="small">
        {emergency.enabled ? t("emergency.statusOn", { n: emergency.allowance }) : t("emergency.statusOff")}
        {" · "}
        {t("emergency.used", { used: emergency.used.count, total: emergency.allowance })}
      </Text>
      {openings.length > 0 ? <OpeningLines openings={openings} withMinutes={false} /> : null}
    </View>
  );
}
