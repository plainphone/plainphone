// SPDX-License-Identifier: Apache-2.0
//
// "Protect against reset" (#20): the parent links their Google account, and the household's
// phones then ask for it after a reset from recovery mode.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../i18n/I18n";
import { api, type ResetProtectionState } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { errorMessage, LiveStatus, LoadGate, type Notice, useLoad } from "./ui";

const RESULTS = { ok: "frp.ok", cancelled: "frp.cancelled", failed: "frp.failed" } as const;

export function ResetProtectionSection({ householdId }: { householdId: string }) {
  const { t, locale } = useI18n();
  const res = useLoad(() => api.get<ResetProtectionState>(`/households/${householdId}/reset-protection`), [householdId]);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  // Back from Google: show the result once and drop it from the address.
  useEffect(() => {
    const result = params.get("reset-protection") as keyof typeof RESULTS | null;
    if (!result || !(result in RESULTS)) return;
    setNotice({ tone: result === "ok" ? "success" : "error", text: t(RESULTS[result]) });
    const next = new URLSearchParams(params);
    next.delete("reset-protection");
    setParams(next, { replace: true });
  }, [params, setParams, t]);

  async function start() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ url: string }>(`/households/${householdId}/reset-protection/google`);
      window.location.assign(r.url);
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.del(`/households/${householdId}/reset-protection/mine`);
      setNotice({ tone: "success", text: t("frp.removed") });
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="frp-h">
      <h2 id="frp-h">{t("frp.title")}</h2>
      <p className="help">{t("frp.intro")}</p>
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(data) => {
          const mine = data.accounts.find((a) => a.mine);
          if (!data.available) return <p className="notice notice-info">{t("frp.unavailable")}</p>;
          return (
            <>
              {data.accounts.length === 0 ? (
                <p className="muted">{t("frp.none")}</p>
              ) : (
                <ul className="list item-list">
                  {data.accounts.map((a) => (
                    <li key={a.userId} className="item">
                      <div>
                        <p className="row-title">{t(a.mine ? "frp.mine" : "frp.other")}</p>
                        <p className="row-meta">
                          {new Date(a.activeFrom).getTime() > Date.now()
                            ? t("frp.activeFrom", { time: formatDateTime(a.activeFrom, locale) })
                            : t("frp.active")}
                        </p>
                      </div>
                      {a.mine && (
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => void remove()} disabled={busy}>
                          {t("frp.remove")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="help">{t("frp.remember")}</p>
              <div>
                <button type="button" className={mine ? "btn btn-secondary" : "btn btn-primary"} onClick={() => void start()} disabled={busy}>
                  {t(mine ? "frp.change" : "frp.button")}
                </button>
              </div>
            </>
          );
        }}
      </LoadGate>
    </section>
  );
}
