// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/I18n";
import { useLiveRefresh } from "../lib/live";
import { acknowledgeSos, api } from "../lib/api";
import { type SosTrigger, triggerLabel } from "@plainphone/shared/sos-options";
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
  const path = `/phones/${pid}/sos` as const;
  const res = useLoad(() => api.get<{ events: SosEvent[]; callbackNumber: string | null }>(phoneName === undefined ? path : `${path}?unseen=1`), [path, phoneName]);
  const { reload, setData } = res;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [name, setName] = useState("");

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

  function eventRow(event: SosEvent, active: boolean) {
    const how = triggerLabel(event.trigger, event.message);
    return (
      <article key={event.id} data-kind={event.kind} className={active ? "sos-alert stack" : "item stack"}>
        <div className="sos-event-heading" id={`sos-${event.id}`}>
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
            // With two alerts open, the button says which child and which alert it answers.
            <button type="button" className="btn btn-primary" disabled={busy} aria-describedby={`sos-${event.id}`} onClick={() => void ack(event.id)}>{t("sos.seen")}</button>
          )}
        </div>
      </article>
    );
  }

  const active = res.data?.events.filter((event) => !event.seenAt) ?? [];
  // A new alert that arrives while the page is open is read out by screen readers. The live region
  // is always rendered, also on the phones list where the panel is otherwise empty: screen readers
  // do not read a live region that is mounted together with its content.
  const live = (
    <p className="sr-only" aria-live="assertive" data-sos-live="">
      {active.map((event) => `${phoneName !== undefined ? `${phoneName}: ` : ""}${t(event.kind === "urgent" ? "sos.urgent" : "sos.help")}.`).join(" ")}
    </p>
  );
  // A failed check is said out loud on the phones list too: silence there reads as "no SOS".
  if (!res.data) {
    return <>{live}{Boolean(res.error) && <p role="status" className="notice notice-error">{phoneName !== undefined && `${phoneName}: `}{t("sos.unavailable")}</p>}</>;
  }
  if (phoneName !== undefined && !active.length) return <>{live}</>;
  return <>{live}
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
      </details>}
    </section>
  </>;
}
