// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/I18n";
import { useLiveRefresh } from "../lib/live";
import { acknowledgeSos, api } from "../lib/api";
import { type SosTrigger, triggerLabel } from "../lib/sos-options";
import { useLoad } from "./ui";

interface SosEvent {
  id: string;
  kind: "urgent" | "help";
  createdAt: string;
  seenAt: string | null;
  seenByName?: string | null;
  deliveryFailedAt?: string | null;
  trigger?: SosTrigger;
  message?: string | null;
  location: { lat: number; lon: number } | null;
}

export function SosPanel({ pid, phoneName }: { pid: string; phoneName?: string }) {
  const { locale, t } = useI18n();
  const path = `/phones/${pid}/sos`;
  const res = useLoad(() => api.get<{ events: SosEvent[]; callbackNumber: string | null }>(phoneName === undefined ? path : `${path}?unseen=1`), [path, phoneName]);
  const { reload, setData } = res;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState<string | null>(null);

  useLiveRefresh(["sos.created", "sos.updated"], pid, reload, 10_000);

  async function ack(id: string) {
    setBusy(true);
    setError(false);
    try {
      const seen = await acknowledgeSos<SosEvent>(pid, id, name);
      setData((data) => data && { ...data, events: data.events.map((event) => event.id === id ? seen : event) });
      await reload();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await api.put(path, { callbackNumber: number?.trim() || null });
      await reload();
      setNumber(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function eventRow(event: SosEvent, active: boolean) {
    const how = triggerLabel(event.trigger, event.message);
    return (
      <article key={event.id} data-kind={event.kind} className={active ? "sos-alert stack" : "item stack"}>
        <div className="sos-event-heading">
          {phoneName !== undefined && <Link to={`/phones/${pid}`}>{phoneName}</Link>}
          <strong>{t(event.kind === "urgent" ? "sos.urgent" : "sos.help")}</strong>
          <time className="row-meta" dateTime={event.createdAt}>
            {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}
          </time>
        </div>
        {how && <p className="row-meta" data-trigger={event.trigger}>{t(how.key, how.values)}</p>}
        {event.deliveryFailedAt && !event.seenAt && <p role="alert">{t("sos.notDelivered")}</p>}
        <div className="actions">
          {event.location && <a className="btn btn-secondary" href={`https://maps.google.com/?q=${event.location.lat},${event.location.lon}`}>{t("sos.map")}</a>}
          {res.data?.callbackNumber && <a className="btn btn-secondary" href={`tel:${res.data.callbackNumber}`}>{t("sos.call")}</a>}
          {event.seenAt ? <span>{event.seenByName ? t("sos.seenBy", { name: event.seenByName }) : t("sos.acknowledged")}</span> : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void ack(event.id)}>{t("sos.seen")}</button>
          )}
        </div>
      </article>
    );
  }

  if (!res.data) return res.error && phoneName === undefined ? <p role="status">{t("sos.unavailable")}</p> : null;
  const active = res.data.events.filter((event) => !event.seenAt);
  if (phoneName !== undefined && !active.length) return null;
  return (
    <section className="section stack" aria-label={t("sos.title")}>
      {active.map((event) => eventRow(event, true))}
      {active.length > 0 && <details>
        <summary>{t("sos.yourName")}</summary>
        <input aria-label={t("sos.yourName")} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </details>}
      {error && <p role="alert">{t("sos.error")}</p>}
      {Boolean(res.error) && <p role="status">{t("sos.unavailable")}</p>}
      {phoneName === undefined && <details>
        <summary>{t("sos.title")}</summary>
        {res.data.events.filter((event) => event.seenAt).map((event) => eventRow(event, false))}
        <form onSubmit={(e) => void save(e)} className="stack">
          <label htmlFor="sos-callback">{t("sos.callback")}</label>
          <input id="sos-callback" type="tel" autoComplete="off" placeholder="+45"
            value={number ?? res.data.callbackNumber ?? ""} onChange={(e) => setNumber(e.target.value)} />
          <button className="btn btn-secondary" disabled={busy || number === null}>{t("app.save")}</button>
        </form>
      </details>}
    </section>
  );
}
