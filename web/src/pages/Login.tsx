// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { errorMessage, Field, LiveStatus, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, serverHasMail } from "../lib/api";
import { type SignInProtection, signInProtection, useBotCheck } from "../lib/bot-check";
import { INVITE_KEY, NEXT_KEY, noteLinkAsked, takeNext, useSession } from "../lib/session";
import { isHostedService, privacyUrl, termsUrl } from "../lib/site-links";

const SELF_HOSTING_GUIDE = "https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md";

function pendingReason(): "invite" | "pair" | null {
  try {
    if (sessionStorage.getItem(INVITE_KEY)) return "invite";
    if (sessionStorage.getItem(NEXT_KEY)?.startsWith("/pair")) return "pair";
  } catch {
    // ignore
  }
  return null;
}

export function LoginPage() {
  const deleted = Boolean((useLocation().state as { deleted?: boolean } | null)?.deleted);
  const { t, locale } = useI18n();
  const { state, refresh } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  /** The hosted service has taken today's new households (SIGNUP_DAILY_CAP). */
  const [capped, setCapped] = useState(false);
  const [mail, setMail] = useState<boolean | null>(null);
  const [reason] = useState(pendingReason);
  // The store review address (docs/store-review.md) gets a code field instead of a mail.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Bot and spam protection the server asks for (docs/operations.md): a background puzzle and a hidden field.
  const [protection, setProtection] = useState<SignInProtection>({ botChallenge: false, honeypot: false });
  const botCheck = useBotCheck(protection.botChallenge);
  const [website, setWebsite] = useState("");

  useEffect(() => {
    void serverHasMail().then(setMail);
    void signInProtection().then(setProtection);
  }, []);

  // While the user opens the mail (often in another tab), notice when the cookie arrives.
  useEffect(() => {
    if (!sentTo) return;
    const id = window.setInterval(() => {
      void refresh().then((me) => {
        if (me) navigate(takeNext(), { replace: true });
      });
    }, 4000);
    return () => window.clearInterval(id);
  }, [sentTo, refresh, navigate]);

  if (state.status === "in") return <Navigate to={takeNext()} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFieldError(undefined);
    setFormError(null);
    setCapped(false);
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setFieldError(t("login.invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      let altcha: string | undefined;
      try {
        altcha = await botCheck.take();
      } catch {
        setFormError(t("botCheck.failed"));
        return;
      }
      const r = await api.post<{ ok: boolean; mailEnabled: boolean; codeSignIn?: boolean }>("/auth/request", {
        email: value,
        locale,
        ...(altcha ? { altcha } : {}),
        ...(website ? { website } : {}),
      });
      if (r.codeSignIn) {
        setCode("");
        setCodeFor(value);
        return;
      }
      // A link this browser asked for is used without a question (pages/AuthCallback.tsx).
      noteLinkAsked();
      setMail(r.mailEnabled);
      setSentTo(value);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields().email) setFieldError(t("login.invalidEmail"));
      else if (err instanceof ApiError && err.data.code === "signup_cap_reached") setCapped(true);
      else if (err instanceof ApiError && err.data.code === "disposable_email") setFieldError(t("disposableEmail.error"));
      else setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!codeFor) return;
    setFieldError(undefined);
    setFormError(null);
    setBusy(true);
    try {
      await api.post("/auth/review", { email: codeFor, code: code.trim(), locale });
      const me = await refresh();
      if (me) navigate(takeNext(), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 400)) setFieldError(t("login.codeWrong"));
      else setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      {codeFor ? (
        <>
          <PageTitle sub={t("login.codeIntro")}>{t("login.codeTitle")}</PageTitle>
          <form onSubmit={submitCode} noValidate className="stack">
            <Field label={t("login.code")} error={fieldError}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  name="code"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              )}
            </Field>
            <LiveStatus notice={formError ? { tone: "error", text: formError } : null} />
            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t("login.codeSending") : t("login.codeSubmit")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setCodeFor(null); setFieldError(undefined); }}>
                {t("login.again")}
              </button>
            </div>
          </form>
        </>
      ) : sentTo && mail !== false ? (
        <>
          <PageTitle>{t("login.sentTitle")}</PageTitle>
          <p>{t("login.sentBody", { email: sentTo })}</p>
          <p className="muted" role="status">
            <span className="spinner" aria-hidden="true" /> {t("login.waiting")}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => setSentTo(null)}>
            {t("login.again")}
          </button>
        </>
      ) : (
        <>
          <PageTitle sub={t("login.intro")}>{t("login.title")}</PageTitle>
          {deleted && <p className="notice notice-info" role="status">{t("login.deleted")}</p>}
          {reason && <p className="notice notice-info">{t(reason === "invite" ? "login.inviteNote" : "login.pairNote")}</p>}
          {mail === false && (
            <div className="notice notice-warn stack-sm" role="note">
              <p>{t("login.noMail")}</p>
              <details className="details details-lead">
                <summary>{t("login.selfHost")}</summary>
                <p>{t("login.selfHostHelp")}{" "}
                  <a href={SELF_HOSTING_GUIDE}>{t("login.selfHostGuide")}</a>
                </p>
              </details>
            </div>
          )}
          <form onSubmit={submit} noValidate className="stack">
            <Field label={t("login.email")} error={fieldError}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              )}
            </Field>
            {protection.honeypot && (
              // A person never sees or reaches this field; a bot that fills in every field does.
              <div className="sr-only" aria-hidden="true">
                <label>
                  {t("botCheck.honeypot")}
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    data-testid="honeypot"
                  />
                </label>
              </div>
            )}
            {capped && (
              <div className="notice notice-info stack-sm" role="status" data-testid="signup-capped">
                <p><strong>{t("signupCap.title")}</strong></p>
                <p>{t("signupCap.body")}</p>
                <p>{t("signupCap.selfHost")} <a href={SELF_HOSTING_GUIDE}>{t("login.selfHostGuide")}</a></p>
              </div>
            )}
            <LiveStatus
              notice={formError ? { tone: "error", text: formError }
                : busy && botCheck.state === "working" ? { tone: "info", text: t("botCheck.working") } : null}
            />
            <div>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t("login.sending") : t("login.submit")}
              </button>
            </div>
          </form>
          {isHostedService(window.location.origin) && (
            <p className="muted">
              {t("login.testService")}{" "}
              <a href={termsUrl(locale)} target="_blank" rel="noopener noreferrer">{t("login.terms")}</a>
              {" · "}
              <a href={privacyUrl(locale)} target="_blank" rel="noopener noreferrer">{t("nav.privacy")}</a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
