// SPDX-License-Identifier: Apache-2.0
//
// Location, "Ring the phone" and "Are you okay?" (docs/location.md).

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { errorMessage, Field, LiveStatus, LoadGate, type Notice, PageTitle, useLoad, useNow } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import {
  api,
  ApiError,
  type Checkin,
  type Contact,
  LOCATION_MODES,
  type LocationMode,
  ALWAYS_FOR,
  type AlwaysFor,
  type LocationState,
  type Ring,
} from "../lib/api";
import { formatDateTime, formatMeters, formatRelative } from "../lib/format";
import { isAppleMobile, positionText, routeLinks } from "../lib/maps";
import { usePhone } from "./Phone";

const PositionMap = lazy(() => import("../components/PositionMap").then((m) => ({ default: m.PositionMap })));

export const POLL_MS = 5000;
export const FIND_TIMEOUT_MS = 90_000;
export const CHECKIN_MINUTES = [5, 10, 15, 30] as const;

/** A fix answers a request when it was recorded at or after the request. */
export function answers(loc: LocationState["location"], requestedAt: string): boolean {
  return Boolean(loc && new Date(loc.recordedAt).getTime() >= new Date(requestedAt).getTime());
}

/** Something on the phone is still open, so the page keeps polling. */
export function needsPolling(s: LocationState): boolean {
  const c = s.checkin;
  return Boolean(s.ring?.active || c?.status === "waiting" || (c?.status === "noReply" && c.sendsLocation && !c.locatedAt));
}

/** "4:05" */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LocationPage() {
  const { t, locale } = useI18n();
  const [pickAlways, setPickAlways] = useState(false);
  const [alwaysFor, setAlwaysFor] = useState<AlwaysFor>("hour");
  const { phone, setPhone } = usePhone();
  const now = useNow(1000);
  const res = useLoad(() => api.get<LocationState>(`/phones/${phone.id}/location`), [phone.id]);
  const contacts = useLoad(() => api.get<{ contacts: Contact[] }>(`/phones/${phone.id}/contacts`), [phone.id]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  // Keep the ring and check-in status fresh while something is open on the phone.
  const open = res.data ? needsPolling(res.data) : false;
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      void api
        .get<LocationState>(`/phones/${phone.id}/location`)
        .then((r) => res.setData(() => r))
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [open, phone.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(key: string, fn: () => Promise<LocationState | undefined>, success?: string) {
    setBusy(key);
    setNotice(null);
    try {
      const r = await fn();
      if (r) res.setData(() => r);
      else await res.reload();
      if (success) setNotice({ tone: "success", text: success });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  }

  const merge = (patch: Partial<LocationState>) => (res.data ? { ...res.data, ...patch } : undefined);

  async function setMode(mode: LocationMode, forHow?: AlwaysFor) {
    // "always" is time-boxed: picking it first asks for how long.
    if (mode === "always" && !forHow) {
      setPickAlways(true);
      return;
    }
    setPickAlways(false);
    await act(
      "mode",
      async () => {
        const r = await api.put<LocationState>(`/phones/${phone.id}/location/mode`, forHow ? { mode, alwaysFor: forHow } : { mode });
        setPhone({ ...phone, locationEnabled: mode !== "off", locationMode: mode });
        return r;
      },
      t(`loc.mode.${mode}.done`),
    );
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
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(state) => (
          <>
            <PositionSection state={state} now={now} finding={finding} onFind={() => void find()} />

            <RingSection
              ring={state.ring}
              now={now}
              busy={busy}
              onRing={(stopOnAnswer) =>
                void act("ring", async () =>
                  merge({ ring: (await api.post<{ ring: Ring }>(`/phones/${phone.id}/ring`, { stopOnAnswer })).ring }),
                )
              }
              onStop={() =>
                void act(
                  "ring-stop",
                  async () => merge({ ring: (await api.del<{ ring: Ring | null }>(`/phones/${phone.id}/ring`)).ring }),
                  t("ring.stopped"),
                )
              }
            />

            <CheckinSection
              checkin={state.checkin}
              mode={state.mode}
              contacts={contacts.data?.contacts ?? []}
              now={now}
              busy={busy}
              onSend={(minutes, callNumber) =>
                void act("checkin", async () =>
                  merge({
                    checkin: (await api.post<{ checkin: Checkin }>(`/phones/${phone.id}/checkin`, { minutes, callNumber })).checkin,
                  }),
                )
              }
              onCancel={() =>
                void act(
                  "checkin-stop",
                  async () => merge({ checkin: (await api.del<{ checkin: Checkin | null }>(`/phones/${phone.id}/checkin`)).checkin }),
                  t("checkin.cancelled"),
                )
              }
            />

            <section className="section" aria-labelledby="loc-mode-h">
              <h2 id="loc-mode-h">{t("loc.mode.title")}</h2>
              <p className="muted">{t(phone.profile === "self" ? "loc.mode.introSelf" : "loc.mode.intro")}</p>
              <fieldset className="choices" disabled={busy === "mode"} aria-busy={busy === "mode" || undefined}>
                <legend className="sr-only">{t("loc.mode.title")}</legend>
                {LOCATION_MODES.map((m) => (
                  <label key={m} className="choice">
                    <input
                      type="radio"
                      name="loc-mode"
                      value={m}
                      checked={pickAlways ? m === "always" : state.mode === m}
                      onChange={() => void setMode(m)}
                    />
                    <span>
                      <span className="choice-title">{t(`loc.mode.${m}`)}</span>
                      <span className="choice-desc">{t(`loc.mode.${m}.help`)}</span>
                      {m === "always" && <span className="choice-note">{t("loc.mode.always.teen")}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
              {(pickAlways || state.mode === "always") && (
                <div className="always-for">
                  {state.mode === "always" && state.alwaysUntil && (
                    <p className="status-line status-live">
                      {t("loc.always.until", { time: formatDateTime(state.alwaysUntil, locale) })}
                    </p>
                  )}
                  <fieldset className="segmented" disabled={busy === "mode"}>
                    <legend>{t(state.mode === "always" ? "loc.always.change" : "loc.always.for")}</legend>
                    {ALWAYS_FOR.map((f) => (
                      <label key={f} className="seg">
                        <input type="radio" name="always-for" value={f} checked={alwaysFor === f} onChange={() => setAlwaysFor(f)} />
                        <span>{t(`loc.always.${f}`)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="actions">
                    <button type="button" className="btn btn-primary" disabled={busy === "mode"} onClick={() => void setMode("always", alwaysFor)}>
                      {t(state.mode === "always" ? "loc.always.restart" : "loc.always.start")}
                    </button>
                    {pickAlways && (
                      <button type="button" className="btn btn-secondary" onClick={() => setPickAlways(false)}>
                        {t("loc.always.cancel")}
                      </button>
                    )}
                  </p>
                  <p className="muted">{t("loc.always.fallback")}</p>
                </div>
              )}
            </section>
          </>
        )}
      </LoadGate>
    </>
  );
}

function PositionSection({ state, now, finding, onFind }: { state: LocationState; now: number; finding: boolean; onFind: () => void }) {
  const { t, locale } = useI18n();
  const { phone } = usePhone();
  const [copied, setCopied] = useState(false);
  const loc = state.location;
  const apple = typeof navigator !== "undefined" && isAppleMobile(navigator.userAgent, navigator.maxTouchPoints);

  async function copy() {
    if (!loc) return;
    const text = positionText(loc.lat, loc.lon);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t("loc.copyPrompt"), text);
    }
  }

  return (
    <section className="section" aria-labelledby="loc-h">
      <div className="section-head">
        <h2 id="loc-h">{t("loc.last")}</h2>
        {state.mode !== "off" && (
          <button type="button" className="btn btn-primary" onClick={onFind} disabled={finding}>
            {finding && <span className="spinner" aria-hidden="true" />}
            {finding ? t("loc.findingShort") : t("loc.find")}
          </button>
        )}
      </div>
      {state.mode === "off" ? (
        <div className="empty-inline">
          <p className="h3">{t("loc.offTitle")}</p>
          <p>{t("loc.offBody")}</p>
        </div>
      ) : loc ? (
        <div className="position-card">
          <Suspense fallback={<div className="map map-loading" aria-hidden="true" />}>
            <PositionMap
              lat={loc.lat}
              lon={loc.lon}
              accuracyM={loc.accuracyM}
              label={t("loc.mapLabel", { name: phone.name })}
              fallback={t("loc.mapFailed")}
            />
          </Suspense>
          <div className="position-meta">
            <p>
              <strong>{formatRelative(loc.recordedAt, now, locale)}</strong>
              <span className="muted"> · {formatDateTime(loc.recordedAt, locale)}</span>
              {loc.accuracyM !== null && (
                <span className="muted"> · {t("loc.accuracyShort", { distance: formatMeters(loc.accuracyM, locale) })}</span>
              )}
            </p>
            <div className="route-links" role="group" aria-label={t("loc.driveThere")}>
              {routeLinks(loc.lat, loc.lon, apple).map((l) => (
                <a key={l.app} className="btn btn-secondary" href={l.url} target="_blank" rel="noopener noreferrer">
                  {t(l.app === "apple" ? "loc.appleMaps" : "loc.googleMaps")}
                  <span className="external" aria-hidden="true"> ↗</span>
                </a>
              ))}
              <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
                {copied ? t("loc.copied") : t("loc.copy")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="empty-inline">{t(state.mode === "always" ? "loc.none" : "loc.noneOnDemand")}</p>
      )}
    </section>
  );
}

function RingSection({
  ring,
  now,
  busy,
  onRing,
  onStop,
}: {
  ring: Ring | null;
  now: number;
  busy: string | null;
  onRing: (stopOnAnswer: boolean) => void;
  onStop: () => void;
}) {
  const { t, locale } = useI18n();
  const [keep, setKeep] = useState(false);
  const left = ring ? new Date(ring.endsAt).getTime() - now : 0;
  const active = Boolean(ring?.active && left > 0);
  let status: string | null = null;
  if (ring) {
    const time = (iso: string) => formatDateTime(iso, locale);
    if (ring.answeredAt) status = t(active ? "ring.answeredStillRinging" : "ring.answered", { time: time(ring.answeredAt), left: countdown(left) });
    else if (active) status = t(ring.shownAt ? "ring.ringing" : "ring.waiting", { left: countdown(left) });
    else if (ring.stoppedAt) status = t("ring.stoppedAt", { time: time(ring.stoppedAt) });
    else status = t("ring.noAnswer");
  }
  return (
    <section className="section" aria-labelledby="ring-h">
      <h2 id="ring-h">{t("ring.title")}</h2>
      <p className="muted">{t("ring.intro")}</p>
      {status && (
        <p className={`status-line${active ? " status-live" : ""}`} role="status">
          {active && <span className="pulse" aria-hidden="true" />}
          {status}
        </p>
      )}
      {active ? (
        <p>
          <button type="button" className="btn btn-danger" onClick={onStop} disabled={busy === "ring-stop"}>
            {t("ring.stop")}
          </button>
        </p>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>{t("ring.keep")}</span>
          </label>
          <p>
            <button type="button" className="btn btn-primary" onClick={() => onRing(!keep)} disabled={busy === "ring"}>
              {busy === "ring" && <span className="spinner" aria-hidden="true" />}
              {t("ring.start")}
            </button>
          </p>
        </>
      )}
    </section>
  );
}

const NO_CALL = "none";

function CheckinSection({
  checkin,
  mode,
  contacts,
  now,
  busy,
  onSend,
  onCancel,
}: {
  checkin: Checkin | null;
  mode: LocationMode;
  contacts: Contact[];
  now: number;
  busy: string | null;
  onSend: (minutes: number, callNumber: string | null) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [minutes, setMinutes] = useState<number>(10);
  const [picked, setPicked] = useState<string | null>(null);
  const number = picked ?? contacts[0]?.number ?? NO_CALL;
  const waiting = checkin?.status === "waiting";
  const sends = mode === "checkin" || mode === "always";

  let status: string | null = null;
  if (checkin) {
    const time = (iso: string) => formatDateTime(iso, locale);
    switch (checkin.status) {
      case "waiting":
        status = t(checkin.shownAt ? "checkin.shown" : "checkin.waiting", { left: countdown(new Date(checkin.deadline).getTime() - now) });
        break;
      case "answered":
        status = t(checkin.answer === "call" ? "checkin.answeredCall" : "checkin.answeredOk", { time: time(checkin.answeredAt!) });
        break;
      case "cancelled":
        status = t("checkin.cancelledAt", { time: time(checkin.stoppedAt!) });
        break;
      case "noReply":
        status = checkin.locatedAt
          ? t("checkin.noReplyLocated", { time: time(checkin.locatedAt) })
          : checkin.sendsLocation
            ? t("checkin.noReplyLocating")
            : t("checkin.noReply");
    }
  }

  return (
    <section className="section" aria-labelledby="checkin-h">
      <h2 id="checkin-h">{t("checkin.title")}</h2>
      <p className="muted">{t(sends ? "checkin.intro" : "checkin.introNoLocation")}</p>
      {status && (
        <p className={`status-line${waiting ? " status-live" : ""}${checkin?.status === "noReply" ? " status-warn" : ""}`} role="status">
          {waiting && <span className="pulse" aria-hidden="true" />}
          {status}
        </p>
      )}
      {waiting ? (
        <p>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy === "checkin-stop"}>
            {t("checkin.cancel")}
          </button>
        </p>
      ) : (
        <form
          className="checkin-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSend(minutes, number === NO_CALL ? null : number);
          }}
        >
          <fieldset className="segmented">
            <legend>{t("checkin.minutes")}</legend>
            {CHECKIN_MINUTES.map((m) => (
              <label key={m} className="seg">
                <input type="radio" name="checkin-minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} />
                <span>{t("checkin.minutesN", { n: m })}</span>
              </label>
            ))}
          </fieldset>
          {contacts.length > 0 ? (
            <Field label={t("checkin.callMe")} help={t("checkin.callMeHelp")}>
              {(p) => (
                <select {...p} value={number} onChange={(e) => setPicked(e.target.value)}>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.number}>
                      {c.name} ({c.number})
                    </option>
                  ))}
                  <option value={NO_CALL}>{t("checkin.noCall")}</option>
                </select>
              )}
            </Field>
          ) : (
            <p className="muted">{t("checkin.noContacts")}</p>
          )}
          <p>
            <button type="submit" className="btn btn-primary" disabled={busy === "checkin"}>
              {busy === "checkin" && <span className="spinner" aria-hidden="true" />}
              {t("checkin.send")}
            </button>
          </p>
        </form>
      )}
    </section>
  );
}
