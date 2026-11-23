// SPDX-License-Identifier: Apache-2.0
import {
  type DependencyList,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/I18n";
import type { T } from "@plainphone/i18n/translate";
import { ApiError } from "../lib/api";
import { planLimitKey, planLimitOf } from "@plainphone/shared/billing";

/** Turns any error into a sentence for the user. */
export function errorMessage(err: unknown, t: T): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("error.network");
    const limit = planLimitOf(err.status, err.data);
    if (limit) return t(planLimitKey(limit), { max: limit.max });
    // Today's new households are taken on the hosted service (SIGNUP_DAILY_CAP).
    if (err.data.code === "signup_cap_reached") return `${t("signupCap.body")} ${t("signupCap.selfHost")}`;
    // The server's mail cap, or a busy mail server (MAIL_HOURLY_CAP, MAIL_DAILY_CAP; docs/operations.md).
    if (err.data.code === "mail_unavailable") return t("mailUnavailable.error");
    // Bot and spam protection (docs/operations.md, "Bot and spam protection").
    if (err.data.code === "invite_cap_reached") return t("inviteCap.error");
    if (err.data.code === "household_phone_cap") return t("phoneCap.error", { max: Number(err.data.max) || 0 });
    if (err.data.code === "disposable_email") return t("disposableEmail.error");
    if (err.data.code === "bot_challenge_failed" || err.data.code === "bot_challenge_required") return t("botCheck.failed");
    if (err.status === 429) return t("error.tooMany");
    if (err.status === 404) return t("error.notFound");
    if (err.status === 400 && err.issues.length) return t("error.form");
  }
  return t("error.generic");
}

export interface Loaded<D> {
  data: D | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (fn: (d: D | undefined) => D | undefined) => void;
}

/** Loads data on mount and when deps change. Keeps old data while reloading. */
export function useLoad<D>(fn: () => Promise<D>, deps: DependencyList): Loaded<D> {
  const [data, setDataState] = useState<D | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // Only the newest request may set the state. An older one (for the previous phone, or a poll
  // that started before a change) can finish last and would show stale data.
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (latest.current === id) {
        setDataState(d);
        setError(null);
      }
    } catch (err) {
      if (latest.current === id) setError(err);
    } finally {
      if (latest.current === id) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => {
      latest.current++;
    };
  }, deps);
  const setData = useCallback((f: (d: D | undefined) => D | undefined) => setDataState(f), []);
  return { data, error, loading, reload, setData };
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function Loading() {
  const { t } = useI18n();
  return (
    <p className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {t("app.loading")}
    </p>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state state-error" role="alert">
      <p>
        <strong>{t("error.load")}</strong> {errorMessage(error, t)}
      </p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {t("app.retry")}
        </button>
      )}
    </div>
  );
}

/** Wraps a loaded resource: spinner first, error with retry, then the content. */
export function LoadGate<D>({ res, children }: { res: Loaded<D>; children: (d: D) => ReactNode }) {
  if (res.data === undefined) {
    if (res.error) return <ErrorState error={res.error} onRetry={() => void res.reload()} />;
    return <Loading />;
  }
  return <>{children(res.data)}</>;
}

export type Tone = "info" | "success" | "error";
export interface Notice {
  tone: Tone;
  text: string;
  /** An in-app link after the text, e.g. to the plan page. */
  link?: { to: string; label: string };
}

/** Like errorMessage, as a notice: a free plan limit (402) links to the plan page. */
export function errorNotice(err: unknown, t: T): Notice {
  const limit = err instanceof ApiError ? planLimitOf(err.status, err.data) : null;
  return {
    tone: "error",
    text: errorMessage(err, t),
    ...(limit ? { link: { to: "/plan", label: t("plan.limitLink") } } : {}),
  };
}

/** The text of a notice, with its link when it has one. */
export function NoticeText({ notice }: { notice: Notice }) {
  return (
    <p>
      {notice.text}
      {notice.link && (
        <>
          {" "}
          <Link to={notice.link.to}>{notice.link.label}</Link>
        </>
      )}
    </p>
  );
}

/** Polite live region for async results. Always rendered, so screen readers pick up changes. */
export function LiveStatus({ notice, onClose }: { notice: Notice | null; onClose?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="live" aria-live="polite" aria-atomic="true">
      {notice && (
        <div className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : undefined}>
          <NoticeText notice={notice} />
          {onClose && (
            <button type="button" className="btn-icon" onClick={onClose} aria-label={t("app.close")}>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Field({
  label,
  help,
  error,
  children,
  optional,
}: {
  label: string;
  help?: string;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [help ? helpId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="muted"> ({t("app.optional")})</span>}
      </label>
      {help && (
        <p className="help" id={helpId}>
          {help}
        </p>
      )}
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error && (
        <p className="field-error" id={errId}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <div className="switch-text">
        <span className="switch-label" id={`${id}-l`}>
          {label}
        </span>
        {description && (
          <span className="switch-desc" id={`${id}-d`}>
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Move focus to the new page's heading so screen readers announce route changes.
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="page-title">
      <h1 ref={ref} tabIndex={-1}>
        {children}
      </h1>
      {sub && <p className="lede">{sub}</p>}
    </div>
  );
}

export interface PickOption<V extends string> {
  value: V;
  label: string;
  /** A small mark before the label, e.g. a colour swatch. Hidden from screen readers. */
  mark?: ReactNode;
  /** Picked state stays calm instead of filled, for "nothing is set" choices. */
  quiet?: boolean;
}

/**
 * Pick one of a few choices as a segmented control. Built on radio buttons, so arrow keys,
 * the label and the checked state work for keyboards and screen readers. Name it with
 * `labelledBy` (an element's id) or `label`.
 */
export function PickGroup<V extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
  labelledBy,
  label,
  describedBy,
}: {
  name: string;
  value: V;
  options: readonly PickOption<V>[];
  onChange: (next: V) => void;
  disabled?: boolean;
  labelledBy?: string;
  label?: string;
  describedBy?: string;
}) {
  return (
    <div
      className="pick"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={describedBy}
    >
      {options.map((o) => (
        <label key={o.value} className={`pick-opt${o.quiet ? " pick-opt-quiet" : ""}`}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
          />
          {o.mark}
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
