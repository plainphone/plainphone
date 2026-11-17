// SPDX-License-Identifier: Apache-2.0
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import { formatDateTime } from "../shared/lib/format";
import type { paths } from "../api/schema";
import { Button, Card, errorMessage, LiveStatus, LoadGate, type NoticeValue, Text, useLoad } from "./ui";

type ResetProtectionState = paths["/households/{hid}/reset-protection"]["get"]["responses"][200]["content"]["application/json"];

export function ResetProtection({ hid }: { hid: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { "reset-protection": result } = useLocalSearchParams<{ "reset-protection"?: string }>();
  const params = { path: { hid } };
  const res = useLoad(() => unwrap<ResetProtectionState>(client.GET("/households/{hid}/reset-protection", { params })), [hid]);
  const { reload } = res;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);

  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });
    return () => listener.remove();
  }, [reload]);

  const outcome = result === "ok" || result === "cancelled" || result === "failed" ? result : null;
  const resultNotice: NoticeValue | null = outcome
    ? { tone: outcome === "ok" ? "success" : "error", text: t(`frp.${outcome}`) }
    : null;

  useEffect(() => {
    if (outcome) void reload();
  }, [outcome, reload]);

  function dismissNotice() {
    setNotice(null);
    if (result) router.setParams({ "reset-protection": undefined });
  }

  async function change(remove: boolean) {
    setBusy(true);
    dismissNotice();
    try {
      if (remove) {
        await unwrap(client.DELETE("/households/{hid}/reset-protection/mine", { params }));
        setNotice({ tone: "success", text: t("frp.removed") });
        await reload();
      } else {
        const headers = Platform.OS === "web" ? undefined : { "x-plainphone-app": "parent" };
        const { url } = await unwrap<{ url: string }>(client.POST("/households/{hid}/reset-protection/google", { params, headers }));
        await Linking.openURL(url);
      }
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">{t("frp.title")}</Text>
      <LiveStatus notice={notice ?? resultNotice} onClose={dismissNotice} />
      <LoadGate res={res}>
        {(data) => {
          const mine = data.accounts.some((account) => account.mine);
          return (
            <>
              <Text variant="muted">{t(data.available ? "frp.intro" : "frp.unavailable")}</Text>
              {data.available && !data.accounts.length ? <Text>{t("frp.none")}</Text> : null}
              {data.accounts.map((account) => (
                <Text key={account.userId}>
                  {t(account.mine ? "frp.mine" : "frp.other")}{"\n"}
                  {Date.parse(account.activeFrom) > Date.now()
                    ? t("frp.activeFrom", { time: formatDateTime(account.activeFrom, locale) })
                    : t("frp.active")}
                </Text>
              ))}
              {data.available ? (
                <Button title={t(mine ? "frp.change" : "frp.button")} busy={busy} onPress={() => void change(false)} />
              ) : null}
              {mine ? <Button kind="secondary" title={t("frp.remove")} busy={busy} onPress={() => void change(true)} /> : null}
            </>
          );
        }}
      </LoadGate>
    </Card>
  );
}
