// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Linking, Platform } from "react-native";
import { client, unwrap } from "../api/client";
import type { Phone } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { copyText } from "../lib/clipboard";
import { formatDateTime } from "@plainphone/shared/format";
import { diagnostics, helpUrl, releaseState } from "@plainphone/shared/phoneSupport";
import { usePhone } from "./PhoneContext";
import { Button, Card, errorMessage, Notice, Stack, Switch, Text } from "./ui";

function useHelpLink() {
  const { t, locale } = useI18n();
  const { notify } = usePhone();
  return (recovery = false) => {
    void Linking.openURL(helpUrl(locale, recovery)).catch((error) =>
      notify({ tone: "error", text: errorMessage(error, t) }));
  };
}

export function ReleaseNotice() {
  const { t, locale } = useI18n();
  const { phone } = usePhone();
  const openHelp = useHelpLink();
  const state = releaseState(phone);
  if (!state) return null;
  const report = phone.status?.reportedAt;

  return (
    <Stack>
      <Notice tone={state === "requested" ? "info" : "warn"}
        text={t(state === "old" ? "support.releaseOld" : state === "stalled" ? "support.releaseStalled" : "phone.releasing")} />
      {state !== "requested" ? (
        <Text variant="muted">{report ? t("support.lastReport", { when: formatDateTime(report, locale) }) : t("support.noReport")}</Text>
      ) : null}
      {state === "old" ? <Button kind="secondary" title={t("support.recovery")} onPress={() => openHelp(true)} /> : null}
    </Stack>
  );
}

export function PhoneSupport() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const openHelp = useHelpLink();
  const [saving, setSaving] = useState(false);
  const enabled = phone.supportEnabled !== false;

  async function toggle(setting: "supportEnabled" | "releaseWarningsEnabled", enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await unwrap<Phone>(client.PATCH("/phones/{pid}", {
        params: { path: { pid: phone.id } }, body: { [setting]: enabled },
      })));
    } catch (error) {
      notify({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      if (await copyText(diagnostics(phone)) === "copied") notify({ tone: "success", text: t("support.copied") });
    } catch (error) {
      notify({ tone: "error", text: errorMessage(error, t) });
    }
  }

  return (
    <Card>
      <Text variant="heading">{t("support.help")}</Text>
      <Switch label={t("support.toggle")} help={t("support.toggleHint")} value={enabled} disabled={saving}
        onValueChange={(value) => void toggle("supportEnabled", value)} />
      <Switch label={t("support.releaseWarnings")} help={t("support.releaseWarningsHint")}
        value={phone.releaseWarningsEnabled !== false} disabled={saving}
        onValueChange={(value) => void toggle("releaseWarningsEnabled", value)} />
      {enabled ? (
        <Stack>
          <Button kind="secondary" title={t("support.openHelp")} onPress={() => openHelp()} />
          <Button kind="secondary" title={t(Platform.OS === "web" ? "support.copy" : "support.share")} onPress={() => void copy()} />
        </Stack>
      ) : null}
    </Card>
  );
}
