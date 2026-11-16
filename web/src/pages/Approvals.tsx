// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { errorMessage, LiveStatus, LoadGate, type Notice, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type Approval } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { describeOp } from "../lib/ops";

export function ApprovalsPage() {
  const { t, locale } = useI18n();
  const res = useLoad(() => api.get<{ approvals: Approval[] }>("/approvals").then((r) => r.approvals), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function decide(a: Approval, action: "approve" | "reject") {
    setBusy(a.id);
    setNotice(null);
    try {
      await api.post(`/changes/${a.id}/${action}`);
      setNotice({ tone: "success", text: t(action === "approve" ? "appr.approved" : "appr.rejected") });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t) });
    } finally {
      setBusy(null);
      await res.reload();
    }
  }

  return (
    <>
      <PageTitle sub={t("appr.intro")}>{t("appr.title")}</PageTitle>
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(list) =>
          list.length === 0 ? (
            <p className="empty-inline">{t("appr.empty")}</p>
          ) : (
            <ul className="list item-list">
              {list.map((a) => (
                <li key={a.id} className="item item-stack">
                  <div>
                    <p className="row-title">{describeOp(a.op, t, locale, (pkg) => a.appLabel ?? pkg)}</p>
                    <p className="row-meta">
                      {a.requestedBy ? t("appr.from", { phone: a.phoneName, email: a.requestedBy }) : t("appr.fromPhone", { phone: a.phoneName })}
                    </p>
                    <p className="row-meta">{t("appr.asked", { time: formatDateTime(a.createdAt, locale) })}</p>
                  </div>
                  <div className="actions">
                    <button type="button" className="btn btn-primary" onClick={() => void decide(a, "approve")} disabled={busy === a.id}>
                      {t("appr.approve")}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void decide(a, "reject")} disabled={busy === a.id}>
                      {t("appr.reject")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </LoadGate>
    </>
  );
}
