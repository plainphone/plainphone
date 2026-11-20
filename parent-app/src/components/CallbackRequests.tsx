// SPDX-License-Identifier: Apache-2.0
//
// Callback requests of one Child phone (docs/sos.md#asking-a-parent-to-call). Same states and copy as the
// dashboard (web/src/components/CallbackRequests). Each open request shows the number as saved now and a
// button that opens the normal dialler after an explicit tap, and only once the server has accepted that
// number. If the number is missing or changed since the request, it says so and points to the settings.
// On the overview (`phoneName` set) only open requests show, like an SOS banner.
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking } from "react-native";
import { ApiError, client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import {
  type CallbackList, type CallbackRequest, callbackRefusalKey, callbackStateKey, isOpenCallback,
} from "../shared/lib/sos-options";
import { Button, Card, Notice, Text, useLoad } from "./ui";

export function CallbackRequests({ pid, phoneName }: { pid: string; phoneName?: string }) {
  const { locale, t } = useI18n();
  const params = { path: { pid } };
  const res = useLoad(() => unwrap<CallbackList>(client.GET("/phones/{pid}/callback-requests", { params })), [pid]);
  const { reload } = res;
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [history, setHistory] = useState(false);

  useFocusEffect(useCallback(() => {
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [reload]));

  async function answer(request: CallbackRequest, body: { via: "number"; number: string } | { via: "other" }) {
    setBusy(true);
    setRefused(null);
    try {
      await unwrap(client.POST("/phones/{pid}/callback-requests/{id}/done", { params: { path: { pid, id: request.id } }, body }));
      if (body.via === "number") await Linking.openURL(`tel:${body.number}`);
    } catch (err) {
      setRefused(err instanceof ApiError ? err.message : "changed");
    } finally {
      setBusy(false);
      await reload();
    }
  }

  function card(request: CallbackRequest, number: string | null) {
    const open = isOpenCallback(request);
    return (
      <Card key={request.id} testID={open ? "callback-request" : "callback-history-request"}>
        <Text variant="heading">{phoneName !== undefined ? t("cb.asks", { phone: phoneName }) : t("cb.heading")}</Text>
        <Text>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(request.createdAt))}</Text>
        <Text testID="callback-state">{t(callbackStateKey(request))}</Text>
        {open && request.number === "ok" && number ? (
          <>
            <Text testID="callback-number-line">{t("cb.numberLine", { number })}</Text>
            <Button testID="callback-call" title={t("cb.call", { number })} busy={busy}
              onPress={() => void answer(request, { via: "number", number })} />
            <Button kind="secondary" testID="callback-other" title={t("cb.other")} disabled={busy}
              onPress={() => void answer(request, { via: "other" })} />
          </>
        ) : null}
        {open && request.number !== "ok" ? (
          <>
            <Notice tone="warn" text={t(request.number === "missing" ? "cb.missing" : "cb.changed")} />
            <Text variant="small">{t("cb.settings")}</Text>
            <Button kind="secondary" testID="callback-other" title={t("cb.other")} disabled={busy}
              onPress={() => void answer(request, { via: "other" })} />
          </>
        ) : null}
      </Card>
    );
  }

  if (!res.data) return res.error && phoneName === undefined ? <Notice tone="warn" text={t("cb.unavailable")} /> : null;
  const open = res.data.requests.filter(isOpenCallback);
  const past = res.data.requests.filter((r) => !isOpenCallback(r));
  if (!open.length && (phoneName !== undefined || !past.length)) return null;
  return (
    <>
      {open.map((r) => card(r, res.data?.callbackNumber ?? null))}
      {refused !== null ? <Notice tone="warn" text={t(callbackRefusalKey(refused))} /> : null}
      {phoneName === undefined && past.length > 0 ? (
        <>
          <Button kind="plain" title={t("cb.history")} onPress={() => setHistory(!history)} />
          {history ? past.map((r) => card(r, null)) : null}
        </>
      ) : null}
    </>
  );
}
