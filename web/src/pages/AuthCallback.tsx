// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { errorMessage, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type Locale } from "../lib/api";
import { takeNext, useSession } from "../lib/session";

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
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"));
  const [error, setError] = useState<string | null>(token ? null : t("callback.missing"));
  // A link mailed to the native app (/auth/app) that opened in the browser instead, e.g. in a
  // mail app's own browser. Using it here would use it up, so let the parent choose.
  const [choosing, setChoosing] = useState(() => window.location.pathname === "/auth/app" && !!token);

  useEffect(() => {
    if (!token || choosing) return;
    // Drop the token from the address bar and history right away.
    window.history.replaceState(null, "", window.location.pathname);
    verifyOnce(token, locale)
      .then(() => refresh())
      .then(() => navigate(takeNext(), { replace: true }))
      .catch((err) => {
        setError(err instanceof ApiError && err.status === 400 ? t("callback.failed") : errorMessage(err, t));
      });
  }, [token, choosing]);

  if (choosing && token) {
    return (
      <div className="narrow">
        <PageTitle sub={t("callback.appBody")}>{t("callback.appTitle")}</PageTitle>
        <div className="stack">
          <a className="btn btn-primary" href={`${APP_SCHEME}://auth/app#token=${encodeURIComponent(token)}&server=${encodeURIComponent(window.location.origin)}`}>
            {t("callback.openApp")}
          </a>
          <button type="button" className="btn btn-secondary" onClick={() => setChoosing(false)}>
            {t("callback.here")}
          </button>
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
