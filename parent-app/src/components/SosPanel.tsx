// SPDX-License-Identifier: Apache-2.0
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking } from "react-native";
import { client, unwrap } from "../api/client";
import type { components } from "../api/schema";
import { useI18n } from "../i18n/I18n";
import { triggerLabel } from "../shared/lib/sos-options";
import { Button, Card, Field, Notice, Text, useLoad } from "./ui";

type SosEvent = components["schemas"]["SosEvent"];
type History = { events: SosEvent[]; callbackNumber: string | null };

export function SosPanel({ pid, phoneName }: { pid: string; phoneName?: string }) {
  const { locale, t } = useI18n();
  const params = { path: { pid } };
  const res = useLoad(() => unwrap<History>(client.GET("/phones/{pid}/sos", { params: { ...params, query: phoneName === undefined ? undefined : { unseen: "1" } } })), [pid, phoneName]);
  const { reload, setData } = res;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [name, setName] = useState("");
  const [history, setHistory] = useState(false);
  const [number, setNumber] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [reload]));

  async function save(action: () => Promise<void>) {
    setBusy(true);
    setError(false);
    try {
      await action();
      await reload();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function row(event: SosEvent) {
    const map = event.location && `https://maps.google.com/?q=${event.location.lat},${event.location.lon}`;
    const callback = res.data?.callbackNumber;
    const how = triggerLabel(event.trigger, event.message);
    return (
      <Card key={event.id} testID={event.seenAt ? "sos-history-event" : "sos-banner"}>
        {phoneName !== undefined && <Text variant="heading">{phoneName}</Text>}
        <Text variant="heading">{t(event.kind === "urgent" ? "sos.urgent" : "sos.help")}</Text>
        <Text>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}</Text>
        {how && <Text testID="sos-trigger">{t(how.key, how.values)}</Text>}
        {event.deliveryFailedAt && !event.seenAt && <Text accessibilityRole="alert">{t("sos.notDelivered")}</Text>}
        {map && <Button kind="secondary" title={t("sos.map")} onPress={() => void Linking.openURL(map).catch(() => setError(true))} />}
        {callback && <Button kind="secondary" title={t("sos.call")} onPress={() => void Linking.openURL(`tel:${callback}`).catch(() => setError(true))} />}
        {event.seenAt ? <Text>{event.seenByName ? t("sos.seenBy", { name: event.seenByName }) : t("sos.acknowledged")}</Text> : (
          <Button title={t("sos.seen")} busy={busy} onPress={() => void save(async () => {
            const seen = await unwrap<SosEvent>(client.POST("/phones/{pid}/sos/{id}/seen", { params: { path: { pid, id: event.id } }, body: { name: name.trim() || undefined } }));
            setData((data) => data && { ...data, events: data.events.map((entry) => entry.id === seen.id ? seen : entry) });
          })} />
        )}
      </Card>
    );
  }

  if (!res.data) return res.error && phoneName === undefined ? <Notice tone="warn" text={t("sos.unavailable")} /> : null;
  return (
    <>
      {res.data.events.filter((event) => !event.seenAt).map(row)}
      {res.data.events.some((event) => !event.seenAt) &&
        <Field label={t("sos.yourName")} value={name} onChangeText={setName} maxLength={60} />}
      {error && <Notice tone="warn" text={t("sos.error")} />}
      {Boolean(res.error) && <Notice tone="warn" text={t("sos.unavailable")} />}
      {phoneName === undefined && <Button kind="plain" title={t("sos.title")} onPress={() => setHistory(!history)} />}
      {history && <>
        {res.data.events.filter((event) => event.seenAt).map(row)}
        <Card>
          <Field label={t("sos.callback")} value={number ?? res.data.callbackNumber ?? ""}
            onChangeText={setNumber} keyboardType="phone-pad" autoComplete="off" />
          <Button title={t("app.save")} busy={busy} disabled={number === null} onPress={() => void save(async () => {
            await unwrap(client.PUT("/phones/{pid}/sos", { params, body: { callbackNumber: number?.trim() || null } }));
            setNumber(null);
          })} />
        </Card>
      </>}
    </>
  );
}
