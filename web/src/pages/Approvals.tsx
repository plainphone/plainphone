// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from "react";
import { ApprovalScanner } from "../components/ApprovalScanner";
import { errorMessage, LiveStatus, LoadGate, type Notice, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type Approval } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { describeApproval } from "../lib/ops";

export function ApprovalsPage() {
  const { t, locale } = useI18n();
  const res = useLoad(() => api.get<{ approvals: Approval[] }>("/approvals").then((r) => r.approvals), []);
  const people = useLoad(() => api.get<{ people: { id: string; name: string; owner: string }[] }>("/people-i-help"), []);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("code"));
  useEffect(() => {
    if (window.location.hash.startsWith("#code=")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  const { reload: reloadApprovals } = res;
  const scanApproval = useCallback((value: string) => {
    setCode(value);
    void reloadApprovals();
  }, [reloadApprovals]);
  const requestedId = code?.split(".")[1];
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function decide(a: Approval, action: "approve" | "reject") {
    setBusy(a.id);
    setNotice(null);
    try {
      if (code && action === "approve") {
        await api.post(`/changes/${a.id}/approve-qr`, { challenge: code });
        setCode(null);
      } else await api.post(`/changes/${a.id}/${action}`);
      setNotice({ tone: "success", text: t(action === "approve" ? "appr.approved" : "appr.rejected") });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t) });
    } finally {
      setBusy(null);
      await Promise.all([res.reload(), people.reload()]);
    }
  }

  function changes(list: Approval[], showOwner: boolean) {
    if (list.length === 0) return <p className="empty-inline">{t(code ? "appr.codeUnavailable" : "appr.empty")}</p>;
    return <ul className="list item-list">
      {list.map((a) => (
        <li key={a.id} className="item item-stack">
          <div>
            <p className="row-title">{describeApproval(a.op.type, t, a.appLabel)}</p>
            {showOwner && <p className="row-meta">
              {a.requestedBy ? t("appr.from", { phone: a.phoneName, email: a.requestedBy }) : a.phoneName}
            </p>}
            <p className="row-meta">{t("appr.asked", { time: formatDateTime(a.createdAt, locale) })}</p>
          </div>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => void decide(a, "approve")} disabled={busy !== null}>
              {t("appr.approve")}
            </button>
            {!code && <button type="button" className="btn btn-secondary" onClick={() => void decide(a, "reject")} disabled={busy !== null}>
              {t("appr.reject")}
            </button>}
          </div>
        </li>
      ))}
    </ul>;
  }

  return (
    <>
      <PageTitle sub={t("appr.intro")}>{t("appr.title")}</PageTitle>
      <div className="stack">
        {code
          ? <div><button type="button" className="btn btn-secondary" onClick={() => setCode(null)}>{t("appr.showAll")}</button></div>
          : <ApprovalScanner onCode={scanApproval} />}
        <LiveStatus notice={notice} onClose={() => setNotice(null)} />
        <LoadGate res={res}>{(all) => code
          ? changes(all.filter((a) => a.id === requestedId), true)
          : <LoadGate res={people}>{({ people: list }) => list.length > 0
            ? list.map((person) => <section key={person.id} className="stack" aria-labelledby={`person-${person.id}`}>
              <h2 id={`person-${person.id}`}>{person.name}</h2>
              <p className="row-meta">{person.owner}</p>
              {changes(all.filter((a) => a.phoneId === person.id), false)}
            </section>)
            : changes(all, true)
          }</LoadGate>
        }</LoadGate>
      </div>
    </>
  );
}
