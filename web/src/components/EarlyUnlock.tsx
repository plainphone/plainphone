// SPDX-License-Identifier: Apache-2.0
//
// Paid early unlock on a waiting change (docs/billing.md, #103). Only rendered when the server
// sends `earlyUnlock` on the change. Waiting stays the calm default: one quiet line and a small
// button, then the price, the terms and an unticked consent box, with "Keep waiting (free)"
// exactly as prominent as the pay button. A purchase that can still be withdrawn always shows
// the withdrawal control (forbrugeraftaleloven § 18 and § 20 a).

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type PendingChange } from "../lib/api";
import { type EarlyUnlockOffer, type EarlyUnlockPurchase, formatPrice, purchaseLine } from "../lib/billing";
import { formatDateTime } from "../lib/format";
import { useMe } from "../lib/session";
import { errorNotice, Field, LiveStatus, LoadGate, type Notice, useLoad } from "./ui";
import "./billing.css";

/** The early unlock part of one waiting change. Nothing at all when the server sent no offer. */
export function EarlyUnlock({ change, onChanged }: {
  change: Pick<PendingChange, "id" | "earlyUnlock">;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const offer = change.earlyUnlock;
  if (!offer) return null;
  let content = null;
  if (offer.purchase) content = <PurchaseStatus purchase={offer.purchase} onChanged={onChanged} />;
  else if (offer.available) content = <Offer changeId={change.id} offer={offer} />;
  else if (offer.reason === "weeklyCap" && offer.nextAvailableAt) {
    content = <p className="help">{t("early.weeklyCap", { time: formatDateTime(offer.nextAvailableAt, locale) })}</p>;
  }
  return content && <div className="early-unlock">{content}</div>;
}

function Offer({ changeId, offer }: { changeId: string; offer: EarlyUnlockOffer }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const price = formatPrice(offer.price, offer.currency, locale);

  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  function keepWaiting() {
    setOpen(false);
    setConsent(false);
    setNotice(null);
    // Back to the small button, so keyboard users stay where they were.
    window.setTimeout(() => opener.current?.focus(), 0);
  }

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!consent || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ checkoutUrl: string | null }>(`/changes/${changeId}/early-unlock`, { consent: true, locale });
      if (r?.checkoutUrl) {
        window.location.assign(r.checkoutUrl);
        return;
      }
      setNotice({ tone: "error", text: t("early.unavailable") });
    } catch (err) {
      setNotice(err instanceof ApiError && (err.status === 409 || err.status === 503)
        ? { tone: "error", text: t("early.unavailable") }
        : errorNotice(err, t));
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <div className="early-unlock-offer">
        <p className="help">{t("early.offer", { price })}</p>
        <button ref={opener} type="button" className="btn btn-secondary btn-small" aria-expanded="false" onClick={() => setOpen(true)}>
          {t("early.open")}
        </button>
      </div>
    );
  }

  return (
    <form className="early-unlock-step stack-sm" aria-labelledby={headingId} onSubmit={pay} noValidate>
      <h3 id={headingId} ref={heading} tabIndex={-1}>{t("early.open")}</h3>
      <ul className="early-unlock-terms">
        <li>{t("early.infoPrice", { price })}</li>
        <li>{t("early.infoWhen", { minutes: offer.unlockMinutes })}</li>
        <li>{t("early.infoCap")}</li>
        <li>{t("early.infoWithdraw", { control: t("early.withdraw") })}</li>
      </ul>
      <label className="early-unlock-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("early.consent")}</span>
      </label>
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <div className="actions early-unlock-actions">
        {/* Same size and style on purpose: paying is never the nudged choice. */}
        <button type="submit" className="btn btn-secondary" disabled={!consent || busy}>
          {busy ? t("early.paying") : t("early.pay", { price })}
        </button>
        <button type="button" className="btn btn-secondary" onClick={keepWaiting} disabled={busy}>
          {t("early.keepWaiting")}
        </button>
      </div>
    </form>
  );
}

/** A purchase's state, with "Withdraw from contract" while it can still be withdrawn. */
export function PurchaseStatus({ purchase, onChanged }: { purchase: EarlyUnlockPurchase; onChanged?: (p: EarlyUnlockPurchase) => void }) {
  const { t, locale } = useI18n();
  // The answer of a withdrawal wins until a reload brings the same purchase again.
  const [answered, setAnswered] = useState<EarlyUnlockPurchase | null>(null);
  const current = answered && answered.id === purchase.id ? answered : purchase;
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const line = purchaseLine(current, locale);

  return (
    <div className="stack-sm">
      {line && <p role="status">{t(line.key, line.params)}</p>}
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      {current.canWithdraw && (confirming ? (
        <WithdrawStep
          purchase={current}
          onCancel={() => setConfirming(false)}
          onDone={(p) => {
            setAnswered(p);
            setConfirming(false);
            setNotice({ tone: "success", text: t("early.withdrawDone") });
            onChanged?.(p);
          }}
        />
      ) : (
        <div>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirming(true)}>
            {t("early.withdraw")}
          </button>
        </div>
      ))}
    </div>
  );
}

function WithdrawStep({ purchase, onCancel, onDone }: {
  purchase: EarlyUnlockPurchase;
  onCancel: () => void;
  onDone: (p: EarlyUnlockPurchase) => void;
}) {
  const { t } = useI18n();
  const me = useMe();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const trimmed = name.trim();
      const p = await api.post<EarlyUnlockPurchase>(`/early-unlocks/${purchase.id}/withdraw`, { confirm: true, ...(trimmed ? { name: trimmed } : {}) });
      onDone(p);
    } catch (err) {
      setNotice(errorNotice(err, t));
      setBusy(false);
    }
  }

  return (
    <form className="early-unlock-step stack-sm" aria-labelledby={headingId} onSubmit={confirm} noValidate>
      <h3 id={headingId} ref={heading} tabIndex={-1}>{t("early.withdraw")}</h3>
      <p>{t("early.withdrawEffect")}</p>
      <p className="early-unlock-contract">{t("early.withdrawContract", { id: purchase.id })}</p>
      <p>{t("early.withdrawReceipt", { email: me.user.email })}</p>
      <Field label={t("early.withdrawName")} help={t("early.withdrawNameHelp")} optional>
        {(p) => <input {...p} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{t("early.withdrawConfirm")}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{t("app.cancel")}</button>
      </div>
    </form>
  );
}

/**
 * Where Stripe sends the browser back (`?earlyUnlock={id}`). The payment only counts once the
 * provider's webhook arrived, so a fresh purchase says "waiting for payment confirmation" and
 * checks again by itself for a little while.
 */
export function EarlyUnlockReceipt({ id }: { id: string }) {
  const { t } = useI18n();
  const res = useLoad(() => api.get<EarlyUnlockPurchase>(`/early-unlocks/${encodeURIComponent(id)}`), [id]);
  const waiting = res.data?.status === "created";
  const polls = useRef(0);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (++polls.current > 24) window.clearInterval(timer);
      else void res.reload();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [waiting, res.reload]);
  return (
    <section className="section panel" aria-labelledby="early-receipt-h">
      <h2 id="early-receipt-h">{t("early.receiptTitle")}</h2>
      <LoadGate res={res}>
        {(p) => (
          <div className="stack-sm">
            <PurchaseStatus purchase={p} />
            {p.status === "created" && (
              <div>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void res.reload()} disabled={res.loading}>
                  {t("early.checkAgain")}
                </button>
              </div>
            )}
          </div>
        )}
      </LoadGate>
    </section>
  );
}
