// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/I18n";
import { ApiError, api } from "../lib/api";
import {
  type CallbackList, type CallbackRequest, callbackRefusalKey, callbackStateKey, isOpenCallback,
} from "../lib/sos-options";
import { useLoad } from "./ui";

/**
 * Callback requests of one Child phone (docs/sos.md#asking-a-parent-to-call). Each open request shows
 * the number as saved now and a button that opens the normal dialler after an explicit tap. If the number
 * is missing or changed since the request, it says so and links to the settings instead of dialling.
 * On the overview (`phoneName` set) only open requests show, like an SOS banner.
 */
export function CallbackRequests({ pid, phoneName }: { pid: string; phoneName?: string }) {
  const { locale, t } = useI18n();
  const path = `/phones/${pid}/callback-requests`;
  const res = useLoad(() => api.get<CallbackList>(path), [path]);
  const { reload } = res;
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function answer(request: CallbackRequest, body: { via: "number"; number: string } | { via: "other" }) {
    setBusy(true);
    setRefused(null);
    try {
      await api.post(`${path}/${request.id}/done`, body);
      // Only after the server accepted the number the screen showed does the dialler open.
      if (body.via === "number") window.location.href = `tel:${body.number}`;
    } catch (err) {
      setRefused(err instanceof ApiError ? err.message : "changed");
    } finally {
      setBusy(false);
      await reload();
    }
  }

  function card(request: CallbackRequest, number: string | null) {
    const open = isOpenCallback(request);
    const settings = phoneName === undefined ? "#callback-settings" : `/phones/${pid}#callback-settings`;
    return (
      <article key={request.id} data-state={request.state} className={open ? "sos-alert stack" : "item stack"}>
        <div className="sos-event-heading">
          {phoneName !== undefined && <Link to={`/phones/${pid}`}>{t("cb.asks", { phone: phoneName })}</Link>}
          {phoneName === undefined && <strong>{t("cb.heading")}</strong>}
          <time className="row-meta" dateTime={request.createdAt}>
            {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(request.createdAt))}
          </time>
        </div>
        <p className="row-meta">{t(callbackStateKey(request))}</p>
        {open && request.number === "ok" && number && <>
          <p>{t("cb.numberLine", { number })}</p>
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => void answer(request, { via: "number", number })}>{t("cb.call", { number })}</button>
            <button type="button" className="btn btn-secondary" disabled={busy}
              onClick={() => void answer(request, { via: "other" })}>{t("cb.other")}</button>
          </div>
        </>}
        {open && request.number !== "ok" && <>
          <p role="alert">{t(request.number === "missing" ? "cb.missing" : "cb.changed")}</p>
          <div className="actions">
            {phoneName === undefined ? <a className="btn btn-secondary" href={settings}>{t("cb.settings")}</a>
              : <Link className="btn btn-secondary" to={settings}>{t("cb.settings")}</Link>}
            <button type="button" className="btn btn-secondary" disabled={busy}
              onClick={() => void answer(request, { via: "other" })}>{t("cb.other")}</button>
          </div>
        </>}
      </article>
    );
  }

  if (!res.data) return res.error && phoneName === undefined ? <p role="status">{t("cb.unavailable")}</p> : null;
  const open = res.data.requests.filter(isOpenCallback);
  const past = res.data.requests.filter((r) => !isOpenCallback(r));
  if (!open.length && (phoneName !== undefined || !past.length)) return null;
  return (
    <section className="section stack" aria-label={t("cb.heading")}>
      {open.map((r) => card(r, res.data?.callbackNumber ?? null))}
      {refused !== null && <p role="alert">{t(callbackRefusalKey(refused))}</p>}
      {phoneName === undefined && past.length > 0 && (
        <details>
          <summary>{t("cb.history")}</summary>
          {past.map((r) => card(r, null))}
        </details>
      )}
    </section>
  );
}
