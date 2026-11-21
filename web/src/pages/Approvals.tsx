// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalQueue } from "../components/ApprovalQueue";
import { ApprovalScanner } from "../components/ApprovalScanner";
import { errorMessage, LiveStatus, LoadGate, type Notice, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { EmergencyBlock } from "../components/EmergencyOpenings";
import { useLiveRefresh } from "../lib/live";
import { api, ApiError, type Approval, type EmergencyOpening, type EmergencySettings } from "../lib/api";
import { type ApprovalOutcome, type Decision, decisionOutcome, isFinal, outcomeKey, outcomeOf, type Processed, queueOf } from "../lib/approval-state";

/** `emergency` is missing when the server is older. */
interface HelpedPerson {
  id: string;
  name: string;
  owner: string;
  emergency?: EmergencySettings & { openings?: EmergencyOpening[] };
}

export function ApprovalsPage() {
  const { t } = useI18n();
  const res = useLoad(() => api.get<{ approvals: Approval[] }>("/approvals").then((r) => r.approvals), []);
  const people = useLoad(() => api.get<{ people: HelpedPerson[] }>("/people-i-help"), []);
  const [code, setCode] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("code"));
  useEffect(() => {
    if (window.location.hash.startsWith("#code=")) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);
  const { reload: reloadApprovals } = res;
  useLiveRefresh(["request.created", "request.answered"], undefined, reloadApprovals, null);
  const scanApproval = useCallback((value: string) => {
    setCode(value);
    void reloadApprovals();
  }, [reloadApprovals]);
  const requestedId = code?.split(".")[1];
  const [busy, setBusy] = useState<string | null>(null);
  const sending = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [processed, setProcessed] = useState<Record<string, Processed<Approval>>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function decide(a: Approval, action: Decision) {
    // One answer at a time: a double tap or a second tab must not send it twice.
    if (sending.current) return;
    sending.current = true;
    setBusy(a.id);
    setNotice(null);
    setAnnouncement("");
    let outcome: ApprovalOutcome | null = null;
    try {
      if (code && action === "approve") {
        await api.post(`/changes/${a.id}/approve-qr`, { challenge: code, revision: a.revision });
        setCode(null);
      } else await api.post(`/changes/${a.id}/${action}`, action === "approve" ? { revision: a.revision } : undefined);
      outcome = decisionOutcome(action);
    } catch (err) {
      outcome = err instanceof ApiError && err.status === 409 ? outcomeOf(err.data) : null;
      if (!outcome) setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t(code ? "appr.codeUnavailable" : "appr.previewChanged") : errorMessage(err, t) });
    } finally {
      sending.current = false;
      setBusy(null);
    }
    if (outcome) {
      const final = isFinal(outcome);
      const answered = outcome;
      const text = t(outcomeKey(outcome, action));
      if (final) {
        setProcessed((all) => (all[a.id] ? all : { ...all, [a.id]: { approval: a, outcome: answered, decision: action } }));
        setFocusId(a.id);
        // The answered row shows the result; this hidden live region says it once.
        setAnnouncement(text);
      } else setNotice({ tone: "error", text });
    }
    await Promise.all([res.reload(), people.reload()]);
  }

  function changes(list: Approval[], showOwner: boolean, mine: (a: Approval) => boolean) {
    const { open, done } = queueOf(list, processed);
    const answered = done.filter((d) => mine(d.approval));
    if (open.length === 0 && answered.length === 0) return <p className="empty-inline">{t(code ? "appr.codeUnavailable" : "appr.empty")}</p>;
    return <ApprovalQueue open={open} done={answered} showOwner={showOwner} busy={busy} approveOnly={code !== null}
      focusId={focusId} onDecide={(a, action) => void decide(a, action)} />;
  }

  return (
    <>
      <PageTitle sub={t("appr.intro")}>{t("appr.title")}</PageTitle>
      <div className="stack">
        {code
          ? <div><button type="button" className="btn btn-secondary" onClick={() => setCode(null)}>{t("appr.showAll")}</button></div>
          : <ApprovalScanner onCode={scanApproval} />}
        <LiveStatus notice={notice} onClose={() => setNotice(null)} />
        <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
        <LoadGate res={res}>{(all) => code
          ? changes(all.filter((a) => a.id === requestedId), true, (a) => a.id === requestedId)
          : <LoadGate res={people}>{({ people: list }) => list.length > 0
            ? list.map((person) => <section key={person.id} className="stack" aria-labelledby={`person-${person.id}`}>
              <h2 id={`person-${person.id}`}>{person.name}</h2>
              <p className="row-meta">{person.owner}</p>
              <EmergencyBlock emergency={person.emergency} />
              {changes(all.filter((a) => a.phoneId === person.id), false, (a) => a.phoneId === person.id)}
            </section>)
            : changes(all, true, () => true)
          }</LoadGate>
        }</LoadGate>
      </div>
    </>
  );
}
