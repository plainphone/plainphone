// SPDX-License-Identifier: Apache-2.0
import { useI18n } from "../i18n/I18n";
import { formatDateTime } from "../lib/format";
import { ANSWER_KEY, byKey, MORE_TIME_ANSWERS, type MoreTimeAnswer, type MoreTimeRequest, resultOf } from "../lib/more-time";
import "./status.css";

export interface MoreTimeRequestsProps {
  phoneName: string;
  requests: MoreTimeRequest[];
  /** The request being sent. Its buttons are off, so a second tap cannot send it twice. */
  busy: string | null;
  /** Requests whose answer lost to an earlier one: they say so, calmly. */
  alreadyAnswered: ReadonlySet<string>;
  onAnswer: (r: MoreTimeRequest, answer: MoreTimeAnswer) => void;
}

/** Open requests with four answers; decided and expired ones stay below as a quiet result. */
export function MoreTimeRequests({ phoneName, requests, busy, alreadyAnswered, onAnswer }: MoreTimeRequestsProps) {
  const { t, locale } = useI18n();
  if (requests.length === 0) return null;
  const title = (r: MoreTimeRequest) =>
    r.appLabel === null ? t("moreTime.askTotal", { phone: phoneName }) : t("moreTime.askApp", { phone: phoneName, app: r.appLabel });
  const open = requests.filter((r) => r.status === "pending");
  const done = requests.filter((r) => r.status !== "pending");
  return (
    <section className="section more-time" aria-labelledby="more-time-h">
      <h2 id="more-time-h">{t("moreTime.title")}</h2>
      <ul className="list item-list">
        {open.map((r) => (
          <li key={r.id} className="item item-stack">
            <div>
              <p className="row-title">{title(r)}</p>
              {r.reason && <p className="row-meta">{t("moreTime.reason", { reason: r.reason })}</p>}
              <p className="row-meta">{formatDateTime(r.createdAt, locale)}</p>
            </div>
            <div className="actions">
              {MORE_TIME_ANSWERS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={a === "no" ? "btn btn-secondary btn-small" : "btn btn-primary btn-small"}
                  disabled={busy !== null}
                  onClick={() => onAnswer(r, a)}
                  aria-label={`${t(ANSWER_KEY[a])}: ${title(r)}`}
                >
                  {t(ANSWER_KEY[a])}
                </button>
              ))}
            </div>
          </li>
        ))}
        {done.map((r) => {
          const res = resultOf(r);
          const by = byKey(r);
          return (
            <li key={r.id} className="item item-stack item-answered" data-status={r.status}>
              <div>
                <p className="row-title">{title(r)}</p>
                {r.reason && <p className="row-meta">{t("moreTime.reason", { reason: r.reason })}</p>}
                {res && (
                  <p className="answered-outcome">
                    {t(res.key, { minutes: res.minutes ?? 0 })}
                    {by && <>{". "}{t(by)}</>}
                  </p>
                )}
                {alreadyAnswered.has(r.id) && <p className="row-meta">{t("moreTime.alreadyAnswered")}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
