// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { client, unwrap } from "../api/client";
import type { Phone } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { getItem, setItem } from "../lib/storage";
import { space } from "../lib/theme";
import { usePhone } from "./PhoneContext";
import { Button, Card, errorMessage, Row, Switch, Text } from "./ui";

/** Where the "sleep outside the bedroom" recommendation comes from (docs/evidence.md). */
export const SLEEP_TIP_SOURCE = "https://www.sst.dk/udgivelser/2023/Sundhedsstyrelsens-anbefalinger-om-skaermbrug";
export const SLEEP_TIP_KEY = "pp.tip.sleepOutside";

/** A switch that saves one phone setting at once. The server and the phone treat a missing value as on. */
export function PhoneSwitch({ field, label, help }: { field: "silentBedtime" | "pinApprovalEnabled"; label: string; help: string }) {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [saving, setSaving] = useState(false);

  async function save(enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await unwrap<Phone>(client.PATCH("/phones/{pid}", { params: { path: { pid: phone.id } }, body: { [field]: enabled } })));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  return <Switch label={label} help={help} value={phone[field] !== false} disabled={saving} onValueChange={(enabled) => void save(enabled)} testID={`switch-${field}`} />;
}

/** Shown once: the phone sleeps best outside the bedroom. Dismissing keeps it away on this device. */
export function SleepOutsideTip() {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    void getItem(SLEEP_TIP_KEY).then((seen) => setHidden(seen !== null));
  }, []);
  if (hidden) return null;
  return (
    <Card testID="sleep-tip">
      <View style={{ gap: space.xs }}>
        <Text variant="label">{t("bedtime.tipTitle")}</Text>
        <Text variant="muted">{t("bedtime.tipBody")}</Text>
      </View>
      <Row>
        <Button title={t("bedtime.tipSource")} kind="secondary" onPress={() => void Linking.openURL(SLEEP_TIP_SOURCE)} />
        <Button
          title={t("bedtime.tipDismiss")}
          kind="secondary"
          onPress={() => {
            setHidden(true);
            void setItem(SLEEP_TIP_KEY, "1");
          }}
        />
      </Row>
    </Card>
  );
}
