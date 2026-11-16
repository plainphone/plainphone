// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { errorMessage, LiveStatus, LoadGate, type Notice, PageTitle, Switch, useLoad, useNow } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type LocationState, type Phone } from "../lib/api";
import { formatCoord, formatDateTime, formatMeters, formatRelative, osmUrl } from "../lib/format";
import { usePhone } from "./Phone";

export const POLL_MS = 5000;
export const FIND_TIMEOUT_MS = 90_000;

/** A fix answers a request when it was recorded at or after the request. */
export function answers(loc: LocationState["location"], requestedAt: string): boolean {
  return Boolean(loc && new Date(loc.recordedAt).getTime() >= new Date(requestedAt).getTime());
}

export function LocationPage() {
  const { t, locale } = useI18n();
  const { phone, setPhone } = usePhone();
  const now = useNow(30_000);
  const res = useLoad(() => api.get<LocationState>(`/phones/${phone.id}/location`), [phone.id]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [toggling, setToggling] = useState(false);
  const [finding, setFinding] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function setEnabled(enabled: boolean) {
    setToggling(true);
    setNotice(null);
    try {
      const p = await api.patch<Phone>(`/phones/${phone.id}`, { locationEnabled: enabled });
      setPhone(p);
      await res.reload();
      setNotice({ tone: "success", text: t(enabled ? "loc.turnedOn" : "loc.turnedOff") });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setToggling(false);
    }
  }

  async function find() {
    setNotice({ tone: "info", text: t("loc.finding") });
    setFinding(true);
    let requestedAt: string;
    try {
      requestedAt = (await api.post<{ requestedAt: string }>(`/phones/${phone.id}/locate`)).requestedAt;
    } catch (err) {
      setFinding(false);
      setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("loc.offBody") : errorMessage(err, t) });
      return;
    }
    const started = Date.now();
    const poll = async () => {
      try {
        const r = await api.get<LocationState>(`/phones/${phone.id}/location`);
        res.setData(() => r);
        if (answers(r.location, requestedAt)) {
          setFinding(false);
          setNotice({ tone: "success", text: t("loc.found") });
          return;
        }
      } catch {
        // keep trying until the timeout
      }
      if (Date.now() - started >= FIND_TIMEOUT_MS) {
        setFinding(false);
        setNotice({ tone: "error", text: t("loc.timeout") });
        return;
      }
      timer.current = window.setTimeout(() => void poll(), POLL_MS);
    };
    timer.current = window.setTimeout(() => void poll(), POLL_MS);
  }

  return (
    <>
      <PageTitle sub={t("loc.intro")}>{t("loc.title")}</PageTitle>
      <LoadGate res={res}>
        {(state) => (
          <>
            <div className="panel">
              <Switch
                label={t("loc.switch")}
                description={t("loc.switchHelp")}
                checked={state.enabled}
                busy={toggling}
                onChange={(v) => void setEnabled(v)}
              />
            </div>
            <LiveStatus notice={notice} onClose={() => setNotice(null)} />
            {!state.enabled ? (
              <section className="empty-inline" aria-labelledby="loc-off">
                <h2 id="loc-off" className="h3">
                  {t("loc.offTitle")}
                </h2>
                <p>{t("loc.offBody")}</p>
              </section>
            ) : (
              <section className="section" aria-labelledby="loc-h">
                <h2 id="loc-h">{t("loc.last")}</h2>
                {state.location ? (
                  <div className="position">
                    <p>{t("loc.at", { time: formatDateTime(state.location.recordedAt, locale), ago: formatRelative(state.location.recordedAt, now, locale) })}</p>
                    {state.location.accuracyM !== null && (
                      <p>{t("loc.accuracy", { distance: formatMeters(state.location.accuracyM, locale) })}</p>
                    )}
                    <p className="muted">
                      {t("loc.coords")}: <span className="number">{formatCoord(state.location.lat, locale)}, {formatCoord(state.location.lon, locale)}</span>
                    </p>
                    <p>
                      <a className="btn btn-secondary" href={osmUrl(state.location.lat, state.location.lon)} target="_blank" rel="noopener noreferrer">
                        {t("loc.openMap")}
                        <span className="external" aria-hidden="true"> ↗</span>
                      </a>
                    </p>
                  </div>
                ) : (
                  <p className="empty-inline">{t("loc.none")}</p>
                )}
                <p>
                  <button type="button" className="btn btn-primary" onClick={() => void find()} disabled={finding}>
                    {finding && <span className="spinner" aria-hidden="true" />}
                    {finding ? t("loc.finding") : t("loc.find")}
                  </button>
                </p>
              </section>
            )}
          </>
        )}
      </LoadGate>
    </>
  );
}
