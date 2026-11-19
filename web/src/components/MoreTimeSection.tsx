// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, type Phone } from "../lib/api";
import { merge, type MoreTimeAnswer, type MoreTimeAnswerResult, type MoreTimeRequest } from "../lib/more-time";
import { MoreTimeRequests } from "./MoreTimeRequests";
import { type Notice, useLoad } from "./ui";

const DAY_MS = 24 * 3_600_000;

/** Requests for more time on one phone: open ones to answer, and the last day's results. Refreshes while the page is open. */
export function MoreTimeSection({ phone, setPhone, notify }: {
  phone: Phone;
  setPhone: (phone: Phone) => void;
  notify: (notice: Notice | null) => void;
}) {
  const { t } = useI18n();
  const res = useLoad(() => api.get<{ requests: MoreTimeRequest[] }>(`/phones/${phone.id}/more-time-requests`), [phone.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [lost, setLost] = useState<ReadonlySet<string>>(new Set());
  const sending = useRef(false);
  const { reload, setData } = res;

  useEffect(() => {
    const id = window.setInterval(() => void reload(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  async function answer(r: MoreTimeRequest, a: MoreTimeAnswer) {
    // One answer at a time: a double tap must not send it twice.
    if (sending.current) return;
    sending.current = true;
    setBusy(r.id);
    try {
      const { won, ...decided } = await api.post<MoreTimeAnswerResult>(`/phones/${phone.id}/more-time-requests/${r.id}/answer`, { answer: a });
      // Show the decided state at once, whoever decided it. A lost answer changes nothing and says so.
      setData((d) => (d ? { requests: merge(d.requests, decided) } : d));
      if (!won) setLost((s) => new Set(s).add(r.id));
    } catch {
      notify({ tone: "error", text: t("moreTime.answerFailed") });
    } finally {
      sending.current = false;
      setBusy(null);
    }
    await reload();
    api.get<Phone>(`/phones/${phone.id}`).then(setPhone, () => undefined);
  }

  const now = Date.now();
  // The server sends the last 24 hours; hide older leftovers when the page stays open for days.
  const requests = (res.data?.requests ?? []).filter(
    (r) => r.status === "pending" || now - Date.parse(r.decidedAt ?? r.createdAt) < DAY_MS,
  );
  return <MoreTimeRequests phoneName={phone.name} requests={requests} busy={busy} alreadyAnswered={lost} onAnswer={(r, a) => void answer(r, a)} />;
}
