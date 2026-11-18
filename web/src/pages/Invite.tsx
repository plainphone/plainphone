// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { errorMessage, Loading, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError } from "../lib/api";
import { INVITE_KEY, useSession } from "../lib/session";

const inflight = new Map<string, Promise<unknown>>();

function readToken(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("token");
  try {
    if (fromHash) {
      // Kept for this tab across the login round trip, then removed.
      sessionStorage.setItem(INVITE_KEY, fromHash);
      window.history.replaceState(null, "", window.location.pathname);
      return fromHash;
    }
    return sessionStorage.getItem(INVITE_KEY);
  } catch {
    return fromHash;
  }
}

export function InvitePage() {
  const { t } = useI18n();
  const { state, refresh } = useSession();
  const [token] = useState(readToken);
  const trusted = token?.startsWith("pp_t_") ?? false;
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<"ok" | string | null>(null);

  useEffect(() => {
    if (!token || state.status !== "in" || (trusted && !confirmed)) return;
    let p = inflight.get(token);
    if (!p) {
      p = api.post("/invites/accept", { token });
      inflight.set(token, p);
    }
    p.then(
      () => {
        setResult("ok");
        void refresh();
      },
      (err) => setResult(err instanceof ApiError && err.status === 400 ? t("invite.failed") : errorMessage(err, t)),
    ).finally(() => {
      try {
        sessionStorage.removeItem(INVITE_KEY);
      } catch {
        // ignore
      }
    });
  }, [token, state.status, refresh, t, trusted, confirmed]);

  if (state.status === "loading") return <Loading />;
  if (token && state.status === "anon") return <Navigate to="/login" replace />;

  return (
    <div className="narrow">
      <PageTitle>{t("invite.title")}</PageTitle>
      {!token ? (
        <div className="stack">
          <p className="notice notice-error" role="alert">{t("invite.missing")}</p>
          <Link className="btn btn-secondary" to="/">{t("invite.back")}</Link>
        </div>
      ) : trusted && !confirmed ? (
        <div className="stack">
          <p>{t("invite.trustedHelp")}</p>
          <button className="btn btn-primary" type="button" onClick={() => setConfirmed(true)}>{t("invite.trustedAccept")}</button>
        </div>
      ) : result === null ? (
        <p role="status">
          <span className="spinner" aria-hidden="true" /> {t("invite.accepting")}
        </p>
      ) : result === "ok" ? (
        <div className="stack">
          <p className="notice notice-success" role="status">
            {t(trusted ? "invite.trustedAccepted" : "invite.accepted")}
          </p>
          <p>
            <Link className="btn btn-primary" to={trusted ? "/approvals" : "/"}>
              {t(trusted ? "appr.title" : "invite.toPhones")}
            </Link>
          </p>
        </div>
      ) : (
        <p className="notice notice-error" role="alert">
          {result}
        </p>
      )}
    </div>
  );
}
