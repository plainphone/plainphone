// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { client, unwrap } from "../api/client";
import type { components } from "../api/schema";
import { useI18n } from "../i18n/I18n";
import { useLiveRefresh } from "../lib/live";
import { triggerLabel } from "../shared/lib/sos-options";
import { Button, Card, Field, Notice, Text, useLoad } from "./ui";

type SosEvent = components["schemas"]["SosEvent"];
type History = { events: SosEvent[]; callbackNumber: string | null };

export function SosPanel({ pid, phoneName }: { pid: string; phoneName?: string }) {
  const { locale, t } = useI18n();
  const params = { path: { pid } };
  const res = useLoad(() => unwrap<History>(client.GET("/phones/{pid}/sos", { params: { ...params, query: phoneName === undefined ? undefined : { unseen: "1" } } })), [pid, phoneName]);
  const { reload, reloadQuiet, setData } = res;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [name, setName] = useState("");
  const [history, setHistory] = useState(false);

  // Live: at once. Not live: the 10 s poll it always had.
  useLiveRefresh(["sos.created", "sos.updated"], pid, reloadQuiet, 10_000);

  // A new alert that arrives while the screen is open is read out by screen readers. The alerts
  // the screen opened with are already on it; only later ones are news.
  const known = useRef<{ pid: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!res.data) return;
    if (known.current?.pid !== pid) known.current = null;
    const open = res.data.events.filter((event) => !event.seenAt);
    const before = known.current?.ids;
    const fresh = before ? open.filter((event) => !before.has(event.id)) : [];
    known.current = { pid, ids: new Set([...(before ?? []), ...open.map((event) => event.id)]) };
    for (const event of fresh) {
      const kind = t(event.kind === "urgent" ? "sos.urgent" : "sos.help");
      AccessibilityInfo.announceForAccessibility(phoneName !== undefined ? `${phoneName}: ${kind}` : kind);
    }
    // Runs on new data only: when pid changes, the old phone's data is still shown until the new
    // one arrives, and it must not count as what the new phone opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.data]);

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
    const kind = t(event.kind === "urgent" ? "sos.urgent" : "sos.help");
    const time = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt));
    return (
      <Card key={event.id} testID={event.seenAt ? "sos-history-event" : "sos-banner"}>
        {phoneName !== undefined && <Text variant="heading">{phoneName}</Text>}
        <Text variant="heading">{kind}</Text>
        <Text>{time}</Text>
        {how && <Text testID="sos-trigger">{t(how.key, how.values)}</Text>}
        {event.deliveryFailedAt && !event.seenAt && <Text accessibilityRole="alert">{t("sos.notDelivered")}</Text>}
        {map && <Button kind="secondary" title={t("sos.map")} onPress={() => void Linking.openURL(map).catch(() => setError(true))} />}
        {callback && <Button kind="secondary" title={t("sos.call")} onPress={() => void Linking.openURL(`tel:${callback}`).catch(() => setError(true))} />}
        {event.seenAt ? <Text>{event.seenByName ? t("sos.seenBy", { name: event.seenByName }) : t("sos.acknowledged")}</Text> : (
          // With two alerts open, a screen reader says which child and which alert the button answers.
          <Button title={t("sos.seen")} accessibilityLabel={[t("sos.seen"), phoneName, kind, time].filter(Boolean).join(", ")} busy={busy} onPress={() => void save(async () => {
            const seen = await unwrap<SosEvent>(client.POST("/phones/{pid}/sos/{id}/seen", { params: { path: { pid, id: event.id } }, body: { name: name.trim() || undefined } }));
            setData((data) => data && { ...data, events: data.events.map((entry) => entry.id === seen.id ? seen : entry) });
          })} />
        )}
      </Card>
    );
  }

  // A failed check is said on the phones list too: silence there reads as "no SOS".
  if (!res.data) {
    if (!res.error) return null;
    return <Notice tone="warn" text={phoneName !== undefined ? `${phoneName}: ${t("sos.unavailable")}` : t("sos.unavailable")} />;
  }
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
      </>}
    </>
  );
}
