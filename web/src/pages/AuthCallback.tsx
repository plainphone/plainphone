// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { errorMessage, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type Locale } from "../lib/api";
import { LINK_ASKED_KEY, linkAskedHere, takeNext, useSession } from "../lib/session";

// One verify per token, also when React runs effects twice in development.
const inflight = new Map<string, Promise<unknown>>();
function verifyOnce(token: string, locale: Locale) {
  let p = inflight.get(token);
  if (!p) {
    p = api.post("/auth/verify", { token, locale });
    inflight.set(token, p);
  }
  return p;
}

/** The native app registers this scheme; /auth/app links land here when the app link did not open it. */
export const APP_SCHEME = "plainphone";

export function AuthCallbackPage() {
  const { t, locale } = useI18n();
  const { state, refresh } = useSession();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"));
  // A link someone else sent would sign this browser into their account (login CSRF), and a
  // parent who then adds a phone gives that account the child's phone. A link this browser asked
  // for a moment ago is used straight away; any other link, or one opened while someone is
  // signed in here, asks first.
  const [askedHere] = useState(linkAskedHere);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t("callback.missing"));
  // A link mailed to the native app (/auth/app) that opened in the browser instead, e.g. in a
  // mail app's own browser. Using it here would use it up, so let the parent choose.
  const [choosing, setChoosing] = useState(() => window.location.pathname === "/auth/app" && !!token);
  const running = useRef(false);
  const [started, setStarted] = useState(false);
  const ready = state.status !== "loading";
  // Decided once: the session turns "in" when the link has worked, and that is no reason to ask.
  const needsConfirm = !started && !confirmed && (!askedHere || state.status === "in");

  useEffect(() => {
    // Drop the token from the address bar and history right away; the page keeps it in state.
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [token]);

  useEffect(() => {
    if (!token || choosing || !ready || needsConfirm || running.current) return;
    running.current = true;
    setStarted(true);
    verifyOnce(token, locale)
      .then(() => {
        try {
          localStorage.removeItem(LINK_ASKED_KEY);
        } catch {
          // ignore
        }
        return refresh();
      })
      .then(() => navigate(takeNext(), { replace: true }))
      .catch((err) => {
        setError(err instanceof ApiError && err.status === 400 ? t("callback.failed") : errorMessage(err, t));
      });
  }, [token, choosing, ready, needsConfirm]);

  if (choosing && token) {
    return (
      <div className="narrow">
        <PageTitle sub={t("callback.appBody")}>{t("callback.appTitle")}</PageTitle>
        <div className="stack">
          {!askedHere && <p>{t("callback.confirmBody")}</p>}
          <a className="btn btn-primary" href={`${APP_SCHEME}://auth/app#token=${encodeURIComponent(token)}&server=${encodeURIComponent(window.location.origin)}`}>
            {t("callback.openApp")}
          </a>
          <button type="button" className="btn btn-secondary" onClick={() => {
            // Choosing the browser here is the answer to the question, so it is not asked twice.
            setConfirmed(true);
            setChoosing(false);
          }}>
            {t("callback.here")}
          </button>
        </div>
      </div>
    );
  }

  if (token && !error && ready && needsConfirm) {
    return (
      <div className="narrow">
        <PageTitle sub={t("callback.confirmBody")}>{t("callback.confirmTitle")}</PageTitle>
        <div className="stack">
          {state.status === "in" && <p>{t("callback.signedInAs", { email: state.me.user.email })}</p>}
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setConfirmed(true)}>
              {t("callback.confirm")}
            </button>
            <Link className="btn btn-secondary" to="/">
              {t("app.cancel")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="narrow">
      <PageTitle>{t("callback.title")}</PageTitle>
      {error ? (
        <div className="stack">
          <p className="notice notice-error" role="alert">
            {error}
          </p>
          <p>
            <Link className="btn btn-primary" to="/login">
              {t("callback.toLogin")}
            </Link>
          </p>
        </div>
      ) : (
        <p role="status">
          <span className="spinner" aria-hidden="true" /> {t("callback.working")}
        </p>
      )}
    </div>
  );
}
