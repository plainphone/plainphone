// SPDX-License-Identifier: Apache-2.0
import { messageLanguage } from "../lib/phone-language";
import { createContext, type FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router";
import { ErrorState, errorMessage, Field, Loading, type Notice, PageTitle, Switch, useLoad, useNow } from "../components/ui";
import { SosOptions } from "../components/SosOptions";
import { SosPanel } from "../components/SosPanel";
import { PhoneSwitch } from "../components/BedtimeSettings";
import { type Decision, outcomeKey, outcomeOf } from "../lib/approval-state";
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
import { formatAccountTypes, formatDateTime, formatDuration, formatList, formatPatchMonth, formatRelative, formatTimeOfDay, installWindowOverrunSeconds } from "../lib/format";
import { liftedNotice } from "../lib/liftedPolicies";
import { lockStepLabel } from "../lib/lock-steps";
import { filterStatusKey } from "../lib/filter-status";
import { describeOp } from "../lib/ops";
import { Chevron } from "./Phones";
import { BATTERY_EXEMPTION_POLICY } from "../lib/failedPolicies";
import { isRemoteReleaseTooOld } from "../lib/phoneSupport";
import { PhoneSupport, ReleaseNotice } from "./PhoneSupport";
import { ServerMoveToggle } from "../components/ServerMoveToggle";
import { MoreTimeSection } from "../components/MoreTimeSection";
import { PhoneStateHint, PhoneStateTitle } from "../components/PhoneState";
import { PhoneAppVersion } from "./PhoneAppVersion";
import { AppUpdates } from "../components/AppUpdates";
import { appUpdateReceiptLine } from "../lib/app-updates";
import { healthRows, receiptText } from "../lib/phone-health";
import { isIphone, platformLine } from "../lib/platform";

interface PhoneCtx {
  phone: Phone;
  setPhone: (p: Phone) => void;
  refreshRuleReceipt: () => void;
  pending: PendingChange[];
  reloadPending: (beforeUpdate?: (changes: PendingChange[]) => void) => Promise<void>;
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
  const navigate = useNavigate();
  const phoneRes = useLoad(() => api.get<Phone>(`/phones/${pid}`), [pid]);
  const { reload: reloadPhone, setData: setPhoneData } = phoneRes;
  const refreshRuleReceipt = useCallback(() => {
    setPhoneData((phone) => phone?.ruleReceipt
      ? { ...phone, ruleReceipt: { appliedAt: null, confirmedAt: null } }
      : phone);
    void reloadPhone();
  }, [reloadPhone, setPhoneData]);
  const releasing = Boolean(phoneRes.data?.releaseRequestedAt);
  const releasedText = t("support.phoneUnavailable");
  const atOverview = loc.pathname.replace(/\/$/, "") === `/phones/${pid}`;
  // The overview refreshes itself; the other pages poll here so the rule receipt stays current.
  useEffect(() => {
    if (atOverview) return;
    let active = true;
    const refresh = () => {
      void api.get<Phone>(`/phones/${pid}`).then((phone) => {
        if (active) setPhoneData(() => phone);
      }).catch((err) => {
        if (active && err instanceof ApiError && err.status === 404) {
          navigate("/", { replace: true, state: releasing ? { notice: releasedText } : null });
        }
      });
    };
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pid, atOverview, releasing, releasedText, navigate, setPhoneData]);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [banner, setBanner] = useState<PendingChange | null>(null);

  const reloadPending = useCallback(async (beforeUpdate?: (changes: PendingChange[]) => void) => {
    try {
      const r = await api.get<{ changes: PendingChange[] }>(`/phones/${pid}/changes`);
      beforeUpdate?.(r.changes);
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
          refreshRuleReceipt();
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
    [reloadPending, refreshRuleReceipt, t],
  );

  const appLabel = useCallback((pkg: string) => labels.get(pkg) ?? pkg, [labels]);

  const value = useMemo<PhoneCtx | null>(
    () =>
      phoneRes.data
        ? {
            phone: phoneRes.data,
            setPhone: (p) => phoneRes.setData(() => p),
            refreshRuleReceipt,
            pending,
            reloadPending,
            appLabel,
            setApps,
            run,
            notify: setNotice,
          }
        : null,
    [phoneRes, pending, reloadPending, refreshRuleReceipt, appLabel, setApps, run],
  );

  if (!value) {
    if (phoneRes.error) return <ErrorState error={phoneRes.error} onRetry={() => void phoneRes.reload()} />;
    return <Loading />;
  }

  return (
    <Ctx.Provider value={value}>
      <p className="back">
        {atOverview ? <Link to="/">{t("nav.phones")}</Link> : <Link to={`/phones/${pid}`}>{value.phone.name}</Link>}
      </p>
      {!atOverview && <RuleReceipt phone={value.phone} />}
      {atOverview && value.phone.profile === "child" && <SosPanel key={value.phone.id} pid={value.phone.id} />}
      {atOverview && value.phone.profile === "child" && <SosOptions key={`sos-options-${value.phone.id}`} pid={value.phone.id} />}
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
    const what = banner.summary?.[messageLanguage(locale)] ?? describeOp(banner.op, t, locale, appLabel);
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

function PendingList({ onCancelFocus }: { onCancelFocus: () => void }) {
  const { t, locale } = useI18n();
  const { pending, reloadPending, appLabel, notify } = usePhone();
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);

  async function cancel(c: PendingChange, button: HTMLButtonElement) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/changes/${c.id}/cancel`);
      notify({ tone: "success", text: t("pending.cancelled") });
    } catch (err) {
      notify({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t) });
    } finally {
      await reloadPending((changes) => {
        if (document.activeElement === button && !changes.some((change) => change.id === c.id)) onCancelFocus();
      });
      setBusy(false);
    }
  }

  return (
    <ul className="list pending-list">
      {pending.map((c) => (
        <li key={c.id} className="pending-item">
          <div>
            <p className="row-title">{c.summary?.[messageLanguage(locale)] ?? describeOp(c.op, t, locale, appLabel)}</p>
            <p className="row-meta">{pendingWhen(c, now, t, locale)}</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={(event) => void cancel(c, event.currentTarget)}
            aria-disabled={busy}
          >
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

function RuleReceipt({ phone }: { phone: Phone }) {
  const { t, locale } = useI18n();
  const now = useNow(30_000);
  if (phone.changeReceiptsEnabled === false || !phone.ruleReceipt) return null;
  const updating = phone.mode === "strong" ? appUpdateReceiptLine(phone.status?.appUpdates, now, locale) : null;
  return (
    <p className="rule-receipt" role="status" aria-atomic="true">
      <strong>{t("receipt.title")}</strong>
      <span>{receiptText(phone.ruleReceipt, phone, now, locale, t)}</span>
      {updating && <span>{t(updating.key, updating.params)}</span>}
    </p>
  );
}

/** Existing device details and the optional health checks. */
export function PhoneStatusBlock({ phone, now }: { phone: Phone; now: number }) {
  const { t, locale } = useI18n();
  const s = phone.status;
  const filterStatus = filterStatusKey(s);
  const patchMonth = formatPatchMonth(phone.attestation?.osPatchLevel, locale);
  const failures = s?.failedPolicies ?? [];
  const overrun = failures.map(installWindowOverrunSeconds).find((seconds) => seconds !== undefined);
  const failedSteps = failures.filter((policy) => installWindowOverrunSeconds(policy) === undefined);
  const technicalSteps = failedSteps.filter((step) => step !== BATTERY_EXEMPTION_POLICY);
  const lifted = liftedNotice(s, now);
  const when = (iso: string) => formatRelative(iso, now, locale);
  const showHealth = phone.healthBoardEnabled !== false;
  const rows = showHealth ? healthRows(phone, now, locale, t) : [];
  const lockNeedsAction = showHealth
    ? rows.find((row) => row.key === "lock")?.action
    : s?.lockIntact === false && !s.maintenance;
  return (
    <section className={showHealth ? "section panel phone-health" : "section panel"} aria-labelledby="status-h">
      <h2 id="status-h">{t(showHealth ? "health.title" : "phone.status")}</h2>
      <PhoneStateHint phone={phone} now={now} />
      {showHealth && (
        <dl className="health-rows">
          {rows.map(({ key, label, detail, action }) => (
            <div key={key} className={action ? "health-action" : undefined}>
              <dt>{label}</dt>
              <dd>{detail}</dd>
            </div>
          ))}
        </dl>
      )}
      {!showHealth && filterStatus && <p className={s?.filterWorking ? "help" : "notice notice-warn"}>{t(filterStatus)}</p>}
      {lockNeedsAction && (!showHealth || failedSteps.length > 0) && (
        <div className="notice notice-error" role="status">
          <div>
            {!showHealth && <p className="row-title">{t("phone.lockBroken")}</p>}
            {failedSteps.length > 0 && (
              <p>{t("phone.lockFailed", { steps: formatList([...new Set(failedSteps.map((step) => lockStepLabel(step, t, locale)))], locale) })}</p>
            )}
          </div>
        </div>
      )}
      {!showHealth && s?.callRoleActionNeeded && (
        <p className="notice notice-warn" role="status">{t("phone.callRoleActionNeeded")}</p>
      )}
      {!showHealth && s?.maintenance && <p className="notice notice-warn" role="status">{t("phone.maintenance")}</p>}
      {!showHealth && s?.lockIntact && !s.maintenance && <p className="row-title">{t("phone.lockIntact")}</p>}
      {s?.parallelAppsRemoved && <p className="notice notice-info" role="status">{t("phone.parallelAppsRemoved")}</p>}
      {s?.lateGoogleAccount && <p className="notice notice-warn" role="status">{t("phone.lateGoogleAccount")}</p>}
      {lifted && (
        <p className={lifted.overdue ? "notice notice-warn" : "notice notice-info"} role="status">
          {t(lifted.overdue ? "phone.liftedOverdue" : "phone.liftedOpen", { time: formatTimeOfDay(lifted.until, locale) })}
        </p>
      )}
      {phone.attestation && phone.attestation.state !== "verified" && phone.attestation.state !== "unverifiable" && (
        <p className="notice notice-error" role="status">
          {t(ATTESTATION_TEXT[phone.attestation.state])}
        </p>
      )}
      {s ? (
        <>
          {overrun !== undefined && (
            <p className="notice notice-warn" role="status">{t("phone.installWindowOverrun")}</p>
          )}
          {(overrun !== undefined || technicalSteps.length > 0) && (
            <details className="details details-lead lock-details">
              <summary>{t("phone.lockDetails")}</summary>
              {overrun !== undefined && <p>{t("phone.installWindowOverrunDuration", { seconds: overrun })}</p>}
              {technicalSteps.length > 0 && (
                <ul>
                  {technicalSteps.map((step, index) => <li key={index}><code>{step}</code></li>)}
                </ul>
              )}
            </details>
          )}
          <ul className="list status-list">
            {s.batteryPct !== null && (
              <li>
                {t("phone.battery", { pct: s.batteryPct })}
                {s.charging ? `, ${t("phone.charging")}` : ""}
              </li>
            )}
            <PhoneAppVersion key={phone.id} phoneId={phone.id} status={s} />
            {s.resetProtection && <li>{t(RESET_PROTECTION_TEXT[s.resetProtection])}</li>}
            {phone.mode === "strong" && !phone.attestation && <li>{t("phone.attPending")}</li>}
            {s.accountTypes && s.accountTypes.length > 0 && (
              <li>{t("phone.accountTypes", { types: formatAccountTypes(s.accountTypes, locale) })}</li>
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
          {(phone.attestation?.state === "verified" || phone.attestation?.state === "unverifiable") && (
            <p>{t(ATTESTATION_TEXT[phone.attestation.state])}</p>
          )}
        </>
      )}
      {!showHealth && (phone.dnsConfigured === false || !(phone.rulesDnsReady ?? phone.dnsReady)) && (
        <p className="notice notice-info status-dns">{t(phone.dnsConfigured === false ? "filter.noDnsService" : "phone.dnsWaiting")}</p>
      )}
      {phone.attestation?.lastFailedAt && (
        <p className="help status-updated">{t("phone.attLastFailedAt", { when: when(phone.attestation.lastFailedAt) })}</p>
      )}
      {phone.attestation?.checkedAt && (
        <p className="help status-updated">{t(phone.attestation.lastFailedAt ? "phone.attFindingAt" : "phone.attCheckedAt", { when: when(phone.attestation.checkedAt) })}</p>
      )}
    </section>
  );
}

export function PhoneOverview() {
  const { t } = useI18n();
  const { phone, pending, setPhone, notify } = usePhone();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const base = `/phones/${phone.id}`;
  const rulesHeading = useRef<HTMLHeadingElement>(null);

  // The phone reports in the background: fetch it again while this page is open, so the
  // battery and the lock state are not as old as the moment the parent opened the app.
  const setPhoneRef = useRef(setPhone);
  setPhoneRef.current = setPhone;
  const releasing = Boolean(phone.releaseRequestedAt);
  const unavailableText = t("support.phoneUnavailable");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      api
        .get<Phone>(`/phones/${phone.id}`)
        .then((p) => {
          if (active) setPhoneRef.current(p);
        })
        .catch((err) => {
          if (active && err instanceof ApiError && err.status === 404) {
            navigate("/", { replace: true, state: releasing ? { notice: unavailableText } : null });
          }
        });
    void refresh();
    const id = window.setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [phone.id, releasing, unavailableText, navigate]);
  const groups = [
    {
      title: t("phone.rulesPeople"),
      items: [
        { to: "apps", label: t("phone.apps"), hint: t("phone.appsHint") },
        { to: "contacts", label: t("phone.contacts"), hint: t("phone.contactsHint") },
        { to: "filter", label: t("phone.filter"), hint: t("phone.filterHint") },
      ],
    },
    {
      title: t("phone.rulesWhen"),
      items: [
        { to: "time", label: t("phone.time"), hint: t("phone.timeHint") },
        { to: "schedules", label: t("phone.schedules"), hint: t("phone.schedulesHint") },
        ...(phone.profile === "child" ? [{ to: "modes", label: t("modes.title"), hint: t("modes.switchHelp") }] : []),
      ],
    },
    {
      title: t("phone.rulesDevice"),
      items: [
        {
          to: "location",
          label: t("phone.location"),
          hint: t(phone.locationEnabled ? "phone.locationHintOn" : "phone.locationHintOff"),
        },
        { to: "home", label: t("phone.home"), hint: t("phone.homeHint") },
        { to: "settings", label: t("phone.settings"), hint: t("phone.settingsHint") },
        ...(phone.profile === "self" ? [{ to: "key", label: t("phone.key"), hint: t("phone.keyHint") }] : []),
      ],
    },
  ];

  return (
    <>
      <PageTitle
        sub={
          <span className="row-meta">
            <span className={`tag tag-${phone.profile}`}>{t(phone.profile === "child" ? "profile.child" : "profile.self")}</span>
            <span className="tag">{t(isIphone(phone) ? "platform.iphone" : phone.mode === "light" ? "mode.light" : "mode.strong")}</span>
            <PhoneStateTitle phone={phone} now={now} />
          </span>
        }
      >
        {phone.name}
      </PageTitle>
      <ReleaseNotice phone={phone} />
      {phone.awaitingServerMove && <p className="notice notice-info">{t("move.waiting")}</p>}
      {!phone.pairedAt && !phone.awaitingServerMove && (
        <section className="section panel" aria-labelledby="setup-h">
          <h2 id="setup-h">{t("setup.pendingTitle")}</h2>
          <p className="muted">{t(phone.setupQrAvailable === false ? "setup.codePendingBody" : "setup.pendingBody")}</p>
          {phone.setupQrAvailable !== false && (
            <p>
              <Link to={`${base}/setup`} className="btn btn-primary">
                {t("setup.showQr")}
              </Link>
            </p>
          )}
        </section>
      )}

      {phone.pairedAt && <ServerMoveToggle />}
      {phone.pairedAt && <RequestsSection />}
      {phone.pairedAt && phone.profile === "child" && <MoreTimeSection phone={phone} setPhone={setPhone} notify={notify} />}

      {phone.status?.lockIntact === false && <PhoneStatusBlock phone={phone} now={now} />}

      {pending.length > 0 && (
        <section className="section" aria-labelledby="pending-h">
          <h2 id="pending-h">{t("phone.pendingTitle")}</h2>
          <PendingList onCancelFocus={() => rulesHeading.current?.focus()} />
        </section>
      )}

      <section className="section rules-section" aria-labelledby="rules-h">
        <h2 id="rules-h" ref={rulesHeading} tabIndex={-1}>{t("phone.rules")}</h2>
        <RuleReceipt phone={phone} />
        {isIphone(phone) && <p className="notice notice-info">{t("platform.iosNote")}</p>}
        <div className="stack">
          {groups.map(({ title, items }) => (
            <div key={title} className="stack-sm">
              <h3 className="h3">{title}</h3>
              <ul className="list phone-rules">
                {items.map(({ to, label, hint }) => {
                  const platformNote = platformLine(phone, to);
                  return (
                    <li key={to}>
                      <Link to={`${base}/${to}`} className="row-link">
                        <span className="row-main">
                          <span className="row-title">{label}</span>
                          <span className="row-meta">{hint}</span>
                          {platformNote && <span className="row-meta platform-note">{t(platformNote)}</span>}
                        </span>
                        <Chevron />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {phone.status?.lockIntact !== false && <PhoneStatusBlock phone={phone} now={now} />}

      {phone.pairedAt && <AppUpdates phone={phone} setPhone={setPhone} notify={notify} />}
      <PhoneDisplayPreferences />
      {phone.profile === "child" && phone.pairedAt && (
        <section className="section" aria-label={t("pin.toggle")}>
          <PhoneSwitch phone={phone} field="pinApprovalEnabled" label={t("pin.toggle")} help={t("pin.help")} setPhone={setPhone} notify={notify} />
        </section>
      )}
      {phone.mode === "light" && <LightModeSection phone={phone} />}
      <PhoneSupport phone={phone} setPhone={setPhone} notify={notify} />
      <ManagePhone />
    </>
  );
}

/** What the phone has asked for: an app from its list, or a contact. */
function RequestsSection() {
  const { t } = useI18n();
  const { phone, setPhone, run, notify } = usePhone();
  const res = useLoad(
    () => api.get<{ requests: PhoneRequest[]; recent?: PhoneRequest[] }>(`/phones/${phone.id}/requests`),
    [phone.id, phone.openRequests],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const requests = res.data?.requests ?? [];
  const recent = res.data?.recent ?? [];

  async function done() {
    await res.reload();
    setPhone(await api.get<Phone>(`/phones/${phone.id}`));
  }

  /** Someone answered first: say what was decided, in the words every screen shares. */
  function alreadyAnswered(err: unknown, decision: Decision): boolean {
    if (!(err instanceof ApiError) || err.status !== 409) return false;
    const outcome = outcomeOf(err.data);
    if (!outcome) return false;
    notify({ tone: "success", text: t(outcomeKey(outcome, decision)) });
    return true;
  }

  async function approve(r: PhoneRequest) {
    setBusy(r.id);
    const name = names[r.id]?.trim();
    const body = r.kind === "contact" && name && name !== r.name ? { name } : {};
    try {
      await run(() => api.post<ChangeResult>(`/phones/${phone.id}/requests/${r.id}/approve`, body), t("requests.approved"));
    } catch (err) {
      if (!alreadyAnswered(err, "approve")) notify({ tone: "error", text: errorMessage(err, t) });
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
      if (!alreadyAnswered(err, "reject")) notify({ tone: "error", text: errorMessage(err, t) });
    }
    setBusy(null);
    await done().catch(() => undefined);
  }

  if (requests.length === 0 && recent.length === 0) return null;
  return (
    <>
      {requests.length > 0 && (
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
      )}
      {recent.length > 0 && (
        <section className="section" aria-labelledby="requests-recent-h">
          <h2 id="requests-recent-h">{t("requests.recentTitle")}</h2>
          <ul className="list item-list">
            {recent.map((r) => (
              <li key={r.id} className="item">
                <div>
                  <p className="row-title">{r.kind === "app" ? (r.appLabel ?? r.packageName) : (r.name ?? r.number)}</p>
                  <p className="row-meta">
                    {r.status === "rejected"
                      ? t("requests.tagRejected")
                      : r.decidedVia === "phone"
                        ? t("requests.tagOnPhone")
                        : t("requests.tagApproved")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Protections that must be on for light mode to hold. The others are shown only when off. */
const LIGHT_REQUIRED: Protection[] = ["deviceAdmin", "accessibility", "usageAccess", "vpn", "phoneRole", "smsRole"];

/** Light mode, honestly: what is live right now, and what is weaker than strong mode. */
function LightModeSection({ phone }: { phone: Phone }) {
  const { t, locale } = useI18n();
  const p = phone.status?.protections;
  const rows = p
    ? PROTECTIONS.filter((k) => k !== "deviceOwner" &&
        !(phone.status?.filterMethod === "privateDns" && (k === "vpn" || k === "alwaysOnVpn" || k === "privateDnsOk")) && (LIGHT_REQUIRED.includes(k) || p[k] === false || p[k] === true)).map(
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

/**
 * Rename the phone, release it, or remove it. Releasing switches Plainphone off on the phone;
 * removing only deletes it here. On a Self phone both wait for the key.
 */
function ManagePhone() {
  const { t } = useI18n();
  const { phone, setPhone, run, notify } = usePhone();
  const navigate = useNavigate();
  const [name, setName] = useState(phone.name);
  const [saving, setSaving] = useState(false);
  const [changingWakeups, setChangingWakeups] = useState(false);
  const [confirming, setConfirming] = useState<"release" | "remove" | null>(null);
  const [working, setWorking] = useState(false);
  const trimmed = name.trim();
  const questionRef = useRef<HTMLParagraphElement>(null);
  const self = phone.profile === "self";
  // A release that was asked for once cannot be asked for again; the phone is on its way out.
  const canRelease = phone.pairedAt !== null && !phone.releaseRequestedAt;
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

  async function changeWakeups(settings: { pushWakeups: boolean } | { preferUnifiedPush: boolean }) {
    setChangingWakeups(true);
    try {
      setPhone(await api.patch<Phone>(`/phones/${phone.id}`, settings));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setChangingWakeups(false);
    }
  }

  async function remove() {
    setWorking(true);
    const r = await run(() => api.del<ChangeResult>(`/phones/${phone.id}`), t("phone.removed"));
    setWorking(false);
    setConfirming(null);
    if (r?.status === "applied") navigate("/", { replace: true, state: { notice: t("phone.removed") } });
  }

  async function release() {
    setWorking(true);
    const r = await run(() => api.post<ChangeResult>(`/phones/${phone.id}/release`), t("phone.releaseDone"));
    setConfirming(null);
    if (r?.status === "applied") {
      try {
        setPhone(await api.get<Phone>(`/phones/${phone.id}`));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          navigate("/", { replace: true, state: { notice: t("support.phoneUnavailable") } });
        }
        // Other failures are retried by the overview refresh.
      }
    }
    setWorking(false);
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
      {phone.pushWakeups !== undefined && !phone.releaseRequestedAt ? (
        <div className="stack-sm">
          <Switch checked={phone.pushWakeups} busy={changingWakeups}
            label={t("phone.pushWakeups")} description={t("phone.pushWakeupsHelp")}
            onChange={(enabled) => void changeWakeups({ pushWakeups: enabled })} />
          {phone.pushWakeups && phone.preferUnifiedPush !== undefined ? (
            <Switch checked={phone.preferUnifiedPush} busy={changingWakeups}
              label={t("phone.pushGoogleFree")} description={t("phone.pushGoogleFreeHelp")}
              onChange={(enabled) => void changeWakeups({ preferUnifiedPush: enabled })} />
          ) : null}
          <p className="muted">{t(!phone.pushWakeups ? "phone.pushPolling" : phone.status?.pushProvider === "fcm"
            ? "phone.pushFcm" : phone.status?.pushProvider === "unifiedpush" ? "phone.pushUnified"
            : phone.status?.pushProvider === "none" ? "phone.pushPolling" : "phone.pushWaiting")}</p>
        </div>
      ) : null}
      <div className="danger-zone">
        {confirming ? (
          <div className="stack-sm" role="group" aria-labelledby="danger-q">
            <p id="danger-q" tabIndex={-1} ref={questionRef}>
              <strong>{t(confirming === "release" ? "phone.releaseQuestion" : "phone.removeQuestion")}</strong>{" "}
              {t(
                confirming === "release"
                  ? self
                    ? "phone.releaseSelfConfirm"
                    : isRemoteReleaseTooOld(phone) ? "support.releaseOld" : "phone.releaseConfirm"
                  : self
                    ? "phone.removeSelfConfirm"
                    : "phone.removeConfirm",
              )}
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void (confirming === "release" ? release() : remove())}
                disabled={working}
              >
                {t(confirming === "release" ? "phone.releaseYes" : "phone.removeYes")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={working}>
                {t("app.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="danger-links">
            {canRelease && (
              <button type="button" className="btn-link btn-link-danger" onClick={() => setConfirming("release")}>
                {t("phone.release")}
              </button>
            )}
            <button type="button" className="btn-link btn-link-danger" onClick={() => setConfirming("remove")}>
              {t("phone.remove")}
            </button>
          </div>
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

const displayPreferences = [
  { key: "changeReceiptsEnabled", label: "health.receiptsToggle", help: "health.receiptsHelp" },
  { key: "healthBoardEnabled", label: "health.boardToggle", help: "health.boardHelp" },
  { key: "weeklySummaryEnabled", label: "summary.phoneToggle", help: "summary.phoneHelp" },
] as const;

function PhoneDisplayPreferences() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [saving, setSaving] = useState(false);
  if (phone.changeReceiptsEnabled === undefined && phone.healthBoardEnabled === undefined) return null;

  async function save(key: typeof displayPreferences[number]["key"], enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await api.patch<Phone>(`/phones/${phone.id}`, { [key]: enabled }));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section" aria-labelledby="phone-display-h">
      <h2 id="phone-display-h">{t("health.preferences")}</h2>
      <div className="stack-sm">
        {displayPreferences.map(({ key, label, help }) => (
          <label className="health-preference" key={key}>
            <input
              type="checkbox"
              checked={phone[key] !== false}
              disabled={saving}
              aria-labelledby={`phone-${key}-label`}
              aria-describedby={`phone-${key}-help`}
              onChange={(event) => void save(key, event.target.checked)}
            />
            <span id={`phone-${key}-label`}>{t(label)}</span>
            <span className="help" id={`phone-${key}-help`}>{t(help)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
