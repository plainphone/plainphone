// SPDX-License-Identifier: Apache-2.0
import { createContext, type FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { ErrorState, errorMessage, Field, Loading, type Notice, PageTitle, useLoad, useNow } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey, T } from "../i18n/translate";
import {
  api,
  ApiError,
  type App,
  type ChangeResult,
  type Locale,
  type PendingChange,
  type Phone,
  type PhoneRequest,
  PROTECTIONS,
  type Protection,
} from "../lib/api";
import { formatDateTime, formatDuration, formatList, formatPatchMonth, formatRelative } from "../lib/format";
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

const ATTESTATION_TEXT = {
  verified: "phone.attVerified",
  unlocked: "phone.attUnlocked",
  "custom-os": "phone.attCustomOs",
  "failed-boot": "phone.attFailedBoot",
  revoked: "phone.attRevoked",
  unverifiable: "phone.attUnverifiable",
} as const;

const RESET_PROTECTION_TEXT = {
  on: "phone.frpOn",
  off: "phone.frpOff",
  "no-play-services": "phone.frpNoPlay",
  failed: "phone.frpFailed",
} as const;

/** What the phone reported about its battery, app and lock, and whether the web filter is live. */
export function PhoneStatusBlock({ phone, now }: { phone: Phone; now: number }) {
  const { t, locale } = useI18n();
  const s = phone.status;
  const patchMonth = formatPatchMonth(phone.attestation?.osPatchLevel, locale);
  const when = (iso: string) => formatRelative(iso, now, locale);
  // Last time the phone fetched its rules (the server sees every poll); rulesAppliedAt is only the last lock run.
  const syncedAt = phone.lastSeenAt;
  return (
    <section className="section" aria-labelledby="status-h">
      <h2 id="status-h">{t("phone.status")}</h2>
      {s && !s.lockIntact && (
        <div className="notice notice-error" role="status">
          <div>
            <p className="row-title">{t("phone.lockBroken")}</p>
            {s.failedPolicies.length > 0 && (
              <p>{t("phone.lockFailed", { steps: formatList(s.failedPolicies, locale) })}</p>
            )}
          </div>
        </div>
      )}
      {s?.maintenance && (
        <p className="notice notice-warn" role="status">
          {t("phone.maintenance")}
        </p>
      )}
      {phone.attestation && phone.attestation.state !== "verified" && phone.attestation.state !== "unverifiable" && (
        <p className="notice notice-error" role="status">
          {t(ATTESTATION_TEXT[phone.attestation.state])}
        </p>
      )}
      {s ? (
        <>
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
            {s.resetProtection && <li>{t(RESET_PROTECTION_TEXT[s.resetProtection])}</li>}
            {phone.mode === "strong" && !phone.attestation && <li>{t("phone.attPending")}</li>}
            {s.accountTypes && s.accountTypes.length > 0 && (
              <li>{t("phone.accountTypes", { types: formatList(s.accountTypes, locale) })}</li>
            )}
            {patchMonth && <li>{t("phone.attPatchMonth", { month: patchMonth })}</li>}
            {(phone.attestation?.state === "verified" || phone.attestation?.state === "unverifiable") && (
              <li>{t(ATTESTATION_TEXT[phone.attestation.state])}</li>
            )}
          </ul>
          <p className="help status-updated">{t("phone.statusUpdated", { when: when(s.reportedAt) })}</p>
        </>
      ) : (
        <>
          <p className="muted">{t("phone.statusNone")}</p>
          {(phone.attestation?.state === "verified" || phone.attestation?.state === "unverifiable") && (
            <p>{t(ATTESTATION_TEXT[phone.attestation.state])}</p>
          )}
        </>
      )}
      {phone.attestation?.lastFailedAt && (
        <p className="help status-updated">{t("phone.attLastFailedAt", { when: when(phone.attestation.lastFailedAt) })}</p>
      )}
      {phone.attestation?.checkedAt && (
        <p className="help status-updated">{t(phone.attestation.lastFailedAt ? "phone.attFindingAt" : "phone.attCheckedAt", { when: when(phone.attestation.checkedAt) })}</p>
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
    { to: "time", label: t("phone.time"), hint: t("phone.timeHint") },
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
      {!phone.pairedAt && (
        <section className="section panel" aria-labelledby="setup-h">
          <h2 id="setup-h">{t("setup.pendingTitle")}</h2>
          <p className="muted">{t("setup.pendingBody")}</p>
          <p>
            <Link to={`${base}/setup`} className="btn btn-primary">
              {t("setup.showQr")}
            </Link>
          </p>
        </section>
      )}

      {phone.openRequests > 0 && <RequestsSection />}

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

      {phone.mode === "light" && <LightModeSection phone={phone} />}
      <ManagePhone />
    </>
  );
}

/** What the phone has asked for: an app from its list, or a contact. */
function RequestsSection() {
  const { t } = useI18n();
  const { phone, setPhone, run, notify } = usePhone();
  const res = useLoad(() => api.get<{ requests: PhoneRequest[] }>(`/phones/${phone.id}/requests`), [phone.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const requests = res.data?.requests ?? [];

  async function done() {
    await res.reload();
    setPhone(await api.get<Phone>(`/phones/${phone.id}`));
  }

  async function approve(r: PhoneRequest) {
    setBusy(r.id);
    const name = names[r.id]?.trim();
    const body = r.kind === "contact" && name && name !== r.name ? { name } : {};
    try {
      await run(() => api.post<ChangeResult>(`/phones/${phone.id}/requests/${r.id}/approve`, body), t("requests.approved"));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
    await done().catch(() => undefined);
  }

  async function reject(r: PhoneRequest) {
    setBusy(r.id);
    try {
      await api.post(`/phones/${phone.id}/requests/${r.id}/reject`, {});
      notify({ tone: "success", text: t("requests.rejected") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    }
    setBusy(null);
    await done().catch(() => undefined);
  }

  if (requests.length === 0) return null;
  return (
    <section className="section" aria-labelledby="requests-h">
      <h2 id="requests-h">{t("requests.title", { name: phone.name })}</h2>
      <ul className="list item-list">
        {requests.map((r) => (
          <li key={r.id} className="item item-stack request">
            {r.kind === "app" ? (
              <div>
                <p className="row-title">{r.appLabel ?? r.packageName}</p>
                <p className="row-meta">{t("requests.app")}</p>
              </div>
            ) : (
              <Field label={t("requests.contactName", { number: r.number ?? "" })}>
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    maxLength={60}
                    autoComplete="off"
                    value={names[r.id] ?? r.name ?? ""}
                    onChange={(e) => setNames((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                )}
              </Field>
            )}
            <div className="actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => void approve(r)} disabled={busy !== null}>
                {t("requests.approve")}
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void reject(r)} disabled={busy !== null}>
                {t("requests.reject")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Protections that must be on for light mode to hold. The others are shown only when off. */
const LIGHT_REQUIRED: Protection[] = ["deviceAdmin", "accessibility", "usageAccess", "vpn", "phoneRole", "smsRole"];

/** Light mode, honestly: what is live right now, and what is weaker than strong mode. */
function LightModeSection({ phone }: { phone: Phone }) {
  const { t, locale } = useI18n();
  const p = phone.status?.protections;
  const rows = p
    ? PROTECTIONS.filter((k) => k !== "deviceOwner" && (LIGHT_REQUIRED.includes(k) || p[k] === false || p[k] === true)).map(
        (k) => ({ key: k, ok: p[k] === true, required: LIGHT_REQUIRED.includes(k) }),
      )
    : [];
  const missing = rows.filter((r) => !r.ok).sort((a, b) => Number(b.required) - Number(a.required));
  const on = rows.filter((r) => r.ok);
  return (
    <section className="section light-mode" aria-labelledby="light-h">
      <h2 id="light-h">{t("mode.light")}</h2>
      <p className="help">{t("light.intro")}</p>
      {p ? (
        <>
          <h3 className="h3 light-sub">{t("light.protections")}</h3>
          {missing.length === 0 && <p className="light-allok">{t("light.allOk")}</p>}
          {missing.length > 0 && (
            <ul className="list protection-list">
              {missing.map((r) => (
                <li key={r.key} className={r.required ? "prot prot-missing" : "prot prot-optional"}>
                  <div className="prot-main">
                    <p className="row-title">{t(`prot.${r.key}` as MessageKey)}</p>
                    <p className="prot-why">{t(`prot.${r.key}.missing` as MessageKey)}</p>
                  </div>
                  <span className={r.required ? "tag tag-alert" : "tag tag-waiting"}>{t("light.missing")}</span>
                </li>
              ))}
            </ul>
          )}
          {on.length > 0 && missing.length > 0 && (
            <p className="help light-on">
              {t("light.onList", { list: formatList(on.map((r) => t(`prot.${r.key}` as MessageKey)), locale) })}
            </p>
          )}
        </>
      ) : (
        <p className="muted">{t("light.noReport")}</p>
      )}
      <h3 className="h3 light-sub">{t("light.weakerTitle")}</h3>
      <ul className="weaker">
        {(["1", "2", "3", "4", "5", "6", "7"] as const).map((n) => (
          <li key={n}>{t(`light.weaker${n}` as MessageKey)}</li>
        ))}
      </ul>
    </section>
  );
}

/** Rename the phone, or remove it. On a Self phone the removal waits for the key. */
function ManagePhone() {
  const { t } = useI18n();
  const { phone, setPhone, run, notify } = usePhone();
  const navigate = useNavigate();
  const [name, setName] = useState(phone.name);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const trimmed = name.trim();
  const questionRef = useRef<HTMLParagraphElement>(null);
  // The button that opened the question is gone; move focus to the question itself.
  useEffect(() => {
    if (confirming) questionRef.current?.focus();
  }, [confirming]);

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || trimmed === phone.name) return;
    setSaving(true);
    try {
      setPhone(await api.patch<Phone>(`/phones/${phone.id}`, { name: trimmed }));
      notify({ tone: "success", text: t("app.saved") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    const r = await run(() => api.del<ChangeResult>(`/phones/${phone.id}`), t("phone.removed"));
    setRemoving(false);
    setConfirming(false);
    if (r?.status === "applied") navigate("/", { replace: true, state: { notice: t("phone.removed") } });
  }

  return (
    <section className="section" aria-labelledby="manage-h">
      <h2 id="manage-h">{t("phone.manage")}</h2>
      <form onSubmit={rename} noValidate className="inline-form">
        <Field label={t("phone.name")}>
          {(p) => (
            <input {...p} type="text" maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <button type="submit" className="btn btn-secondary" disabled={saving || !trimmed || trimmed === phone.name}>
          {saving ? t("app.saving") : t("phone.rename")}
        </button>
      </form>
      <div className="danger-zone">
        {confirming ? (
          <div className="stack-sm" role="group" aria-labelledby="remove-q">
            <p id="remove-q" tabIndex={-1} ref={questionRef}>{t(phone.profile === "self" ? "phone.removeSelfConfirm" : "phone.removeConfirm")}</p>
            <div className="actions">
              <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={removing}>
                {t("phone.removeYes")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={removing}>
                {t("app.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-link btn-link-danger" onClick={() => setConfirming(true)}>
            {t("phone.remove")}
          </button>
        )}
      </div>
    </section>
  );
}

/** Pending changes on this phone that match a predicate, for "Waiting" tags next to items. */
export function usePendingWhere(pred: (c: PendingChange) => boolean): PendingChange[] {
  const { pending } = usePhone();
  return pending.filter(pred);
}
