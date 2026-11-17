// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router";
import { ErrorState, errorMessage, Loading, type Notice, PageTitle, useLoad, useNow } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { T } from "../i18n/translate";
import { api, ApiError, type App, type ChangeResult, type Locale, type PendingChange, type Phone } from "../lib/api";
import { formatDateTime, formatDuration, formatList, formatRelative } from "../lib/format";
import { describeOp } from "../lib/ops";
import { Chevron } from "./Phones";

interface PhoneCtx {
  phone: Phone;
  setPhone: (p: Phone) => void;
  pending: PendingChange[];
  reloadPending: () => Promise<void>;
  appLabel: (pkg: string) => string;
  setApps: (apps: App[]) => void;
  /**
   * Runs a rule change and reports the outcome: a short note when applied, the waiting
   * banner when the key holds it back. Validation errors (400 with issues) are rethrown
   * so forms can show them inline; other errors become a notice and return null.
   */
  run: (fn: () => Promise<ChangeResult>, appliedText?: string) => Promise<ChangeResult | null>;
  notify: (n: Notice | null) => void;
}

const Ctx = createContext<PhoneCtx | null>(null);
export function usePhone(): PhoneCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePhone outside PhoneLayout");
  return v;
}

export function durationWords(t: T) {
  return {
    hm: t("duration.hm"),
    h: t("duration.h"),
    m: t("duration.m"),
    lessThanMinute: t("duration.lessThanMinute"),
  };
}

export function pendingWhen(c: PendingChange, now: number, t: T, locale: Locale): string {
  if (c.keyType === "trusted" || !c.effectiveAt) return t("pending.trusted");
  const left = new Date(c.effectiveAt).getTime() - now;
  if (left <= 0) return t("pending.delaySoon");
  return `${t("pending.effective", { time: formatDateTime(c.effectiveAt, locale) })}, ${t("pending.left", {
    left: formatDuration(left, durationWords(t)),
  })}`;
}

export function PhoneLayout() {
  const { pid = "" } = useParams();
  const { t } = useI18n();
  const loc = useLocation();
  const phoneRes = useLoad(() => api.get<Phone>(`/phones/${pid}`), [pid]);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [banner, setBanner] = useState<PendingChange | null>(null);

  const reloadPending = useCallback(async () => {
    try {
      const r = await api.get<{ changes: PendingChange[] }>(`/phones/${pid}/changes`);
      setPending(r.changes);
    } catch {
      // the overview shows its own error; banners keep working without the list
    }
  }, [pid]);

  const setApps = useCallback((apps: App[]) => setLabels(new Map(apps.map((a) => [a.packageName, a.label]))), []);

  useEffect(() => {
    void reloadPending();
    api
      .get<{ apps: App[] }>(`/phones/${pid}/apps`)
      .then((r) => setApps(r.apps))
      .catch(() => undefined);
  }, [pid, reloadPending, setApps]);

  // Leaving a page clears its notes.
  useEffect(() => {
    setNotice(null);
    setBanner(null);
  }, [loc.pathname]);

  // Success notes fade after a while; errors and waiting banners stay until dismissed.
  useEffect(() => {
    if (notice?.tone !== "success") return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const run = useCallback<PhoneCtx["run"]>(
    async (fn, appliedText) => {
      setNotice(null);
      try {
        const r = await fn();
        if (r.status === "applied") {
          setBanner(null);
          setNotice({ tone: "success", text: appliedText ?? t("pending.applied") });
        } else {
          setBanner(r.change);
          await reloadPending();
        }
        return r;
      } catch (err) {
        if (err instanceof ApiError && err.status === 400 && err.issues.length) throw err;
        setNotice({ tone: "error", text: err instanceof ApiError && err.status === 400 ? err.message : errorMessage(err, t) });
        return null;
      }
    },
    [reloadPending, t],
  );

  const appLabel = useCallback((pkg: string) => labels.get(pkg) ?? pkg, [labels]);

  const value = useMemo<PhoneCtx | null>(
    () =>
      phoneRes.data
        ? {
            phone: phoneRes.data,
            setPhone: (p) => phoneRes.setData(() => p),
            pending,
            reloadPending,
            appLabel,
            setApps,
            run,
            notify: setNotice,
          }
        : null,
    [phoneRes, pending, reloadPending, appLabel, setApps, run],
  );

  if (!value) {
    if (phoneRes.error) return <ErrorState error={phoneRes.error} onRetry={() => void phoneRes.reload()} />;
    return <Loading />;
  }

  const atOverview = loc.pathname.replace(/\/$/, "") === `/phones/${pid}`;
  return (
    <Ctx.Provider value={value}>
      <p className="back">
        {atOverview ? <Link to="/">{t("nav.phones")}</Link> : <Link to={`/phones/${pid}`}>{value.phone.name}</Link>}
      </p>
      <Outlet />
      <ChangeBar
        banner={banner}
        notice={notice}
        onDismiss={() => {
          setNotice(null);
          setBanner(null);
        }}
        onCancelled={() => {
          setBanner(null);
          setNotice({ tone: "success", text: t("pending.cancelled") });
          void reloadPending();
        }}
        onError={(text) => setNotice({ tone: "error", text })}
        appLabel={appLabel}
      />
    </Ctx.Provider>
  );
}

/** A calm bar at the bottom of the screen: results of changes and the waiting banner. */
function ChangeBar({
  banner,
  notice,
  onDismiss,
  onCancelled,
  onError,
  appLabel,
}: {
  banner: PendingChange | null;
  notice: Notice | null;
  onDismiss: () => void;
  onCancelled: () => void;
  onError: (text: string) => void;
  appLabel: (pkg: string) => string;
}) {
  const { t, locale } = useI18n();
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  let text: string | null = null;
  if (banner) {
    const what = describeOp(banner.op, t, locale, appLabel);
    let when: string;
    if (banner.keyType === "trusted" || !banner.effectiveAt) when = t("pending.trustedBanner");
    else {
      const left = new Date(banner.effectiveAt).getTime() - now;
      when =
        left <= 0
          ? t("pending.delaySoon")
          : t("pending.delayBanner", {
              time: formatDateTime(banner.effectiveAt, locale),
              left: formatDuration(left, durationWords(t)),
            });
    }
    text = `${what}. ${when}`;
  }

  async function cancel() {
    if (!banner) return;
    setBusy(true);
    try {
      await api.post(`/changes/${banner.id}/cancel`);
      onCancelled();
    } catch (err) {
      onError(err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="change-bar" aria-live="polite" aria-atomic="true">
      {banner && text ? (
        <div className="bar bar-pending">
          <p>{text}</p>
          <div className="bar-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void cancel()} disabled={busy}>
              {t("pending.cancel")}
            </button>
            <button type="button" className="btn-icon" onClick={onDismiss} aria-label={t("app.close")}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      ) : notice ? (
        <div className={`bar bar-${notice.tone}`} role={notice.tone === "error" ? "alert" : undefined}>
          <p>{notice.text}</p>
          <div className="bar-actions">
            <button type="button" className="btn-icon" onClick={onDismiss} aria-label={t("app.close")}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PendingList() {
  const { t, locale } = useI18n();
  const { pending, reloadPending, appLabel, notify } = usePhone();
  const now = useNow(30_000);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function cancel(c: PendingChange) {
    setBusyId(c.id);
    try {
      await api.post(`/changes/${c.id}/cancel`);
      notify({ tone: "success", text: t("pending.cancelled") });
    } catch (err) {
      notify({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t) });
    } finally {
      setBusyId(null);
      await reloadPending();
    }
  }

  if (pending.length === 0) return <p className="muted">{t("phone.pendingNone")}</p>;
  return (
    <ul className="list pending-list">
      {pending.map((c) => (
        <li key={c.id} className="pending-item">
          <div>
            <p className="row-title">{describeOp(c.op, t, locale, appLabel)}</p>
            <p className="row-meta">{pendingWhen(c, now, t, locale)}</p>
          </div>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => void cancel(c)} disabled={busyId === c.id}>
            {t("pending.cancel")}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** What the phone reported about its battery, app and lock, and whether the web filter is live. */
function PhoneStatusBlock({ phone, now }: { phone: Phone; now: number }) {
  const { t, locale } = useI18n();
  const s = phone.status;
  const when = (iso: string) => formatRelative(iso, now, locale);
  // Last time the phone fetched its rules (the server sees every poll); rulesAppliedAt is only the last lock run.
  const syncedAt = phone.lastSeenAt;
  return (
    <section className="section" aria-labelledby="status-h">
      <h2 id="status-h">{t("phone.status")}</h2>
      {s ? (
        <>
          {!s.lockIntact && (
            <div className="notice notice-error" role="status">
              <div>
                <p className="row-title">{t("phone.lockBroken")}</p>
                {s.failedPolicies.length > 0 && (
                  <p>{t("phone.lockFailed", { steps: formatList(s.failedPolicies, locale) })}</p>
                )}
              </div>
            </div>
          )}
          {s.maintenance && (
            <p className="notice notice-warn" role="status">
              {t("phone.maintenance")}
            </p>
          )}
          <ul className="list status-list">
            {s.lockIntact && <li className="row-title">{t("phone.lockIntact")}</li>}
            {s.batteryPct !== null && (
              <li>
                {t("phone.battery", { pct: s.batteryPct })}
                {s.charging ? `, ${t("phone.charging")}` : ""}
              </li>
            )}
            <li>{syncedAt ? t("phone.synced", { when: when(syncedAt) }) : t("phones.neverSeen")}</li>
            <li>{t("phone.appVersion", { version: s.appVersion })}</li>
          </ul>
          <p className="help status-updated">{t("phone.statusUpdated", { when: when(s.reportedAt) })}</p>
        </>
      ) : (
        <p className="muted">{t("phone.statusNone")}</p>
      )}
      {!phone.dnsReady && <p className="notice notice-info status-dns">{t("phone.dnsWaiting")}</p>}
    </section>
  );
}

export function PhoneOverview() {
  const { t, locale } = useI18n();
  const { phone, pending, setPhone } = usePhone();
  const now = useNow(60_000);
  const base = `/phones/${phone.id}`;

  // The phone reports in the background: fetch it again while this page is open, so the
  // battery and the lock state are not as old as the moment the parent opened the app.
  const setPhoneRef = useRef(setPhone);
  setPhoneRef.current = setPhone;
  useEffect(() => {
    const refresh = () =>
      api
        .get<Phone>(`/phones/${phone.id}`)
        .then((p) => setPhoneRef.current(p))
        .catch(() => undefined);
    void refresh();
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(id);
  }, [phone.id]);
  const items: { to: string; label: string; hint: string }[] = [
    { to: "apps", label: t("phone.apps"), hint: t("phone.appsHint") },
    { to: "contacts", label: t("phone.contacts"), hint: t("phone.contactsHint") },
    { to: "filter", label: t("phone.filter"), hint: t("phone.filterHint") },
    { to: "schedules", label: t("phone.schedules"), hint: t("phone.schedulesHint") },
    {
      to: "location",
      label: t("phone.location"),
      hint: t(phone.locationEnabled ? "phone.locationHintOn" : "phone.locationHintOff"),
    },
    { to: "settings", label: t("phone.settings"), hint: t("phone.settingsHint") },
    { to: "home", label: t("phone.home"), hint: t("phone.homeHint") },
  ];
  if (phone.profile === "self") items.push({ to: "key", label: t("phone.key"), hint: t("phone.keyHint") });

  return (
    <>
      <PageTitle
        sub={
          <span className="row-meta">
            <span className={`tag tag-${phone.profile}`}>{t(phone.profile === "child" ? "profile.child" : "profile.self")}</span>
            <span className="tag">{t(phone.mode === "light" ? "mode.light" : "mode.strong")}</span>
            <span>
              {phone.lastSeenAt
                ? t("phone.lastSeen", { when: formatRelative(phone.lastSeenAt, now, locale) })
                : t("phones.neverSeen")}
            </span>
          </span>
        }
      >
        {phone.name}
      </PageTitle>
      {phone.mode === "light" && <p className="notice notice-info">{t("mode.lightNote")}</p>}

      <PhoneStatusBlock phone={phone} now={now} />

      {(phone.profile === "self" || pending.length > 0) && (
        <section className="section" aria-labelledby="pending-h">
          <h2 id="pending-h">{t("phone.pendingTitle")}</h2>
          <PendingList />
        </section>
      )}

      <section className="section" aria-labelledby="rules-h">
        <h2 id="rules-h">{t("phone.rules")}</h2>
        <ul className="list nav-list">
          {items.map((i) => (
            <li key={i.to}>
              <Link to={`${base}/${i.to}`} className="row-link">
                <span className="row-main">
                  <span className="row-title">{i.label}</span>
                  <span className="row-meta">{i.hint}</span>
                </span>
                <Chevron />
              </Link>
            </li>
          ))}
          <li>
            <Link to="/household" className="row-link">
              <span className="row-main">
                <span className="row-title">{t("phone.household")}</span>
                <span className="row-meta">{t("phone.householdHint")}</span>
              </span>
              <Chevron />
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}

/** Pending changes on this phone that match a predicate, for "Waiting" tags next to items. */
export function usePendingWhere(pred: (c: PendingChange) => boolean): PendingChange[] {
  const { pending } = usePhone();
  return pending.filter(pred);
}
