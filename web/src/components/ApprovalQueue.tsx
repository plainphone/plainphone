// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { useI18n } from "../i18n/I18n";
import type { Approval } from "../lib/api";
import { type Decision, outcomeKey, type Processed, queueSummaryKey } from "../lib/approval-state";
import { formatDateTime } from "../lib/format";
import "./status.css";

export interface ApprovalQueueProps {
  open: Approval[];
  done: Processed<Approval>[];
  /** Name the phone in each row (a helper looks after several people). */
  showOwner: boolean;
  /** The request being sent. Its buttons are off, so a second tap cannot send it twice. */
  busy: string | null;
  /** A scanned code approves one request. Declining is done from the list. */
  approveOnly: boolean;
  /** The answered request that gets keyboard focus, so focus does not fall back to the top of the page. */
  focusId: string | null;
  onDecide: (a: Approval, action: Decision) => void;
}

/** Open requests first, then the answered ones with their outcome in place. */
export function ApprovalQueue({ open, done, showOwner, busy, approveOnly, focusId, onDecide }: ApprovalQueueProps) {
  const { t, locale } = useI18n();
  const summary = queueSummaryKey(open.length, done.length);
  useEffect(() => {
    if (focusId) document.getElementById(`answered-${focusId}`)?.focus();
  }, [focusId]);
  const meta = (a: Approval) => (
    <>
      {showOwner && <p className="row-meta">{a.requestedBy ? t("appr.from", { phone: a.phoneName, email: a.requestedBy }) : a.phoneName}</p>}
      <p className="row-meta">{t("appr.asked", { time: formatDateTime(a.createdAt, locale) })}</p>
    </>
  );
  return (
    <div className="stack approval-queue">
      {summary && <p className="row-title queue-summary">{t(summary.key, { n: summary.n })}</p>}
      {open.length > 0 && (
        <ul className="list item-list">
          {open.map((a) => (
            <li key={a.id} className="item item-stack">
              <div>
                <p className="row-title">{a.summary[locale]}</p>
                {meta(a)}
              </div>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => onDecide(a, "approve")} aria-label={`${t("appr.approve")}: ${a.summary[locale]}`} disabled={busy !== null}>
                  {t("appr.approve")}
                </button>
                {!approveOnly && <button type="button" className="btn btn-secondary" onClick={() => onDecide(a, "reject")} aria-label={`${t("appr.reject")}: ${a.summary[locale]}`} disabled={busy !== null}>
                  {t("appr.reject")}
                </button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <ul className="list item-list" aria-label={t("status.answered")}>
          {done.map(({ approval: a, outcome, decision }) => (
            <li key={a.id} className="item item-stack item-answered" data-outcome={outcome}>
              <div>
                <p className="row-title" id={`answered-${a.id}`} tabIndex={-1}>{a.summary[locale]}</p>
                {meta(a)}
                <p className="answered-outcome">{t(outcomeKey(outcome, decision))}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
