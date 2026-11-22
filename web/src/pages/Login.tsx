// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { errorMessage, Field, LiveStatus, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, serverHasMail } from "../lib/api";
import { INVITE_KEY, NEXT_KEY, noteLinkAsked, takeNext, useSession } from "../lib/session";

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

  useEffect(() => {
    void serverHasMail().then(setMail);
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
      const r = await api.post<{ ok: boolean; mailEnabled: boolean }>("/auth/request", { email: value, locale });
      // A link this browser asked for is used without a question (pages/AuthCallback.tsx).
      noteLinkAsked();
      setMail(r.mailEnabled);
      setSentTo(value);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields().email) setFieldError(t("login.invalidEmail"));
      else if (err instanceof ApiError && err.data.code === "signup_cap_reached") setCapped(true);
      else setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      {sentTo && mail !== false ? (
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
            {capped && (
              <div className="notice notice-info stack-sm" role="status" data-testid="signup-capped">
                <p><strong>{t("signupCap.title")}</strong></p>
                <p>{t("signupCap.body")}</p>
                <p>{t("signupCap.selfHost")} <a href={SELF_HOSTING_GUIDE}>{t("login.selfHostGuide")}</a></p>
              </div>
            )}
            <LiveStatus notice={formError ? { tone: "error", text: formError } : null} />
            <div>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t("login.sending") : t("login.submit")}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
