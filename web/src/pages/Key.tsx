// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useState } from "react";
import { encode } from "uqr";
import { QrImage } from "./AddPhone";
import { Navigate, useSearchParams } from "react-router";
import { errorNotice, Field, LoadGate, PageTitle, Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type ChangeResult, type KeyInput, type SelfKey } from "../lib/api";
import { EmergencySection } from "../components/EmergencyOpenings";
import { EarlyUnlockReceipt } from "../components/EarlyUnlock";
import { formatPrice, type Plan } from "../lib/billing";
import type { MessageKey } from "../i18n/translate";
import { useMe } from "../lib/session";
import { usePhone } from "./Phone";
import { usePlan } from "./Plan";

export function KeyPage() {
  const { t } = useI18n();
  const { phone } = usePhone();
  const res = useLoad(() => api.get<SelfKey>(`/phones/${phone.id}/key`), [phone.id]);
  const plan = usePlan();
  // Stripe sends the browser back here after paying for an early unlock. The receipt shows
  // also with billing off again: the right to withdraw stays.
  const [params] = useSearchParams();
  const earlyUnlock = params.get("earlyUnlock");
  if (phone.profile !== "self") return <Navigate to={`/phones/${phone.id}`} replace />;
  return (
    <>
      <PageTitle sub={t("key.intro")}>{t("key.title")}</PageTitle>
      {earlyUnlock && <EarlyUnlockReceipt id={earlyUnlock} />}
      <SelfTemplate phoneId={phone.id} />
      <LoadGate res={res}>{(key) => <KeyForm current={key} plan={plan} onSaved={() => void res.reload()} />}</LoadGate>
      <EmergencySection />
    </>
  );
}

type Level = "mild" | "firm" | "strict";
type Choice = Level | "custom";
const LEVELS: readonly Level[] = ["mild", "firm", "strict"];

function choiceOf(key: Pick<SelfKey, "keyType" | "delayHours">): Choice {
  if (key.keyType === "trusted") return "strict";
  return key.delayHours === 1 ? "mild" : key.delayHours === 24 ? "firm" : "custom";
}

function KeyForm({ current, plan, onSaved }: { current: SelfKey; plan: Plan | null; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const { phone, run, notify } = usePhone();
  // The level is only a name for the key: Mild is a 1 hour delay, Firm 24 hours, Strict a trusted
  // person. Any other delay is "custom", with no card picked until the user picks one.
  const [choice, setChoice] = useState<Choice>(choiceOf(current));
  // The delay in hours: what Advanced shows for a custom key, and what Strict keeps as its fallback wait.
  const [hours, setHours] = useState(String(current.delayHours));
  const [advancedOpen, setAdvancedOpen] = useState(choiceOf(current) === "custom");
  const [email, setEmail] = useState(current.trustedEmail ?? "");
  const [qrInvite, setQrInvite] = useState(current.keyType === "trusted" && !current.trustedEmail);
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [errors, setErrors] = useState<{ hours?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);
  const [payUnlock, setPayUnlock] = useState(current.payUnlockEnabled);
  const keyType = choice === "strict" ? "trusted" : "delay";
  // Paid early unlock (docs/billing.md): only with billing on, and only for the user's own delay key.
  const offerSwitch = Boolean(plan?.billing) && keyType === "delay";
  const level = choice === "custom" ? null : choice;
  const shownHours = choice === "mild" ? "1" : choice === "firm" ? "24" : hours;
  const sentHours = choice === "mild" ? 1 : choice === "firm" ? 24 : Number(hours);

  function pick(next: Level) {
    setChoice(next);
    setErrors({});
  }
  function setHoursFromSelect(value: string) {
    setHours(value);
    // Strict keeps its trusted person; the hours are only its fallback wait.
    if (choice !== "strict") setChoice(value === "1" ? "mild" : value === "24" ? "firm" : "custom");
  }

  useEffect(() => {
    setChoice(choiceOf(current));
    setAdvancedOpen(choiceOf(current) === "custom");
    setHours(String(current.delayHours));
    setEmail(current.trustedEmail ?? "");
    setQrInvite(current.keyType === "trusted" && !current.trustedEmail);
    setInviteUrl(undefined);
    setPayUnlock(current.payUnlockEnabled);
  }, [current]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const h = sentHours;
    const mail = email.trim().toLowerCase();
    const next: typeof errors = {};
    if (!Number.isInteger(h) || h < 1 || h > 72) next.hours = t("key.hoursInvalid");
    if (keyType === "trusted" && !qrInvite && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail === me.user.email)) next.email = t("key.emailInvalid");
    setErrors(next);
    if (next.hours || next.email) return;
    const body: KeyInput = {
      keyType,
      delayHours: h,
      trustedEmail: keyType === "trusted" && !qrInvite ? mail : null,
      ...(keyType === "trusted" && qrInvite ? { qrInvite: true } : {}),
      // The early unlock switch only exists with billing on and a delay key; otherwise the stored
      // value goes back unchanged. Amount and recipient are not used any more and echo as stored.
      payUnlockEnabled: offerSwitch ? payUnlock : current.payUnlockEnabled,
      payUnlockAmount: current.payUnlockAmount,
      payUnlockRecipient: current.payUnlockRecipient,
    };
    setSaving(true);
    try {
      const r = await run(() => api.put<ChangeResult>(`/phones/${phone.id}/key`, body), t("app.saved"));
      if (r?.status === "applied") onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        const f = err.fields();
        setErrors({ hours: f.delayHours ? t("key.hoursInvalid") : undefined, email: f.trustedEmail ? t("key.emailInvalid") : undefined });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack">
      {current.keyType === "trusted" && current.trustedEmail && (
        <p className={`notice ${current.trustedAccepted ? "notice-success" : "notice-info"}`}>
          {t(current.trustedAccepted ? "key.accepted" : "key.notAccepted", { email: current.trustedEmail })}
        </p>
      )}
      {current.keyType === "trusted" && !current.trustedEmail && (
        <p className={`notice ${current.trustedAccepted ? "notice-success" : "notice-info"}`}>
          {t(current.trustedAccepted ? "key.qrAccepted" : "key.qrWaiting", { hours: current.delayHours })}
        </p>
      )}
      <fieldset className="choices">
        <legend>{t("key.type")}</legend>
        {LEVELS.map((l) => (
          <label key={l} className="choice">
            <input type="radio" name="keyLevel" value={l} checked={level === l} onChange={() => pick(l)} />
            <span>
              <span className="choice-title">{t(`key.level.${l}` as MessageKey)}</span>
              <span className="choice-desc">{t(`key.level.${l}Help` as MessageKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {choice === "custom" && <p className="help" role="status">{t("key.level.custom", { hours: Number(hours) || current.delayHours })}</p>}
      {keyType === "trusted" && (
        <label><input type="checkbox" checked={qrInvite} onChange={(e) => setQrInvite(e.target.checked)} /> {t("key.qrInvite")}</label>
      )}
      {keyType === "trusted" && !qrInvite && (
        <Field label={t("key.email")} help={t("key.emailHelp")} error={errors.email}>
          {(p) => <input {...p} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
      )}
      <details className="key-advanced" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
        <summary>{t("key.advanced")}</summary>
        <Field label={t("key.hours")} help={`${t("key.advancedHelp")} ${t("key.hoursHelp")}`} error={errors.hours}>
          {(p) => (
            <select {...p} className="input-short" value={shownHours} onChange={(e) => setHoursFromSelect(e.target.value)}>
              {[...new Set([1, 6, 12, 24, 48, 72, current.delayHours])].sort((a, b) => a - b).map((value) =>
                <option key={value} value={value}>{value}</option>,
              )}
            </select>
          )}
        </Field>
      </details>

      {current.keyType === "trusted" && !current.trustedEmail && !current.trustedAccepted && (
        <div className="stack">
          <div><button type="button" className="btn btn-secondary" onClick={async () => {
            try {
              const invite = await api.post<{ url: string }>(`/phones/${phone.id}/trusted-invite`);
              if (invite) setInviteUrl(invite.url);
            } catch (err) {
              notify(errorNotice(err, t));
            }
          }}>{t("key.showInviteQr")}</button></div>
          <p className="help">{t("key.qrExpiredHint")}</p>
          {inviteUrl && <>
            <p>{t("key.inviteQrHelp")}</p>
            <QrImage modules={encode(inviteUrl, { border: 0 }).data} label={t("key.showInviteQr")} />
            <a href={inviteUrl}>{t("key.openInvite")}</a>
          </>}
        </div>
      )}
      {current.keyType === "trusted" && current.trustedAccepted && (
        <p className="help">{t("key.endHelp")}</p>
      )}
      {offerSwitch && plan && (
        <Switch
          label={t("early.switch")}
          description={t("early.switchHelp", { price: formatPrice(plan.prices.earlyUnlock, plan.prices.currency, locale) })}
          checked={payUnlock}
          onChange={setPayUnlock}
        />
      )}
      <p className="help">{t("key.looseningNote")}</p>
      <div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t("app.saving") : t("app.save")}
        </button>
      </div>
    </form>
  );
}


function SelfTemplate({ phoneId }: { phoneId: string }) {
  const { t } = useI18n();
  const { notify, phone } = usePhone();
  const [url, setUrl] = useState<string>();
  if (!phone.pairedAt) return null;
  return <div className="stack">
    <div><button type="button" className="btn btn-secondary" onClick={async () => {
      try {
        const response = await api.post<{ url: string }>(`/phones/${phoneId}/self-template`);
        if (response) setUrl(response.url);
      } catch (err) {
        notify(errorNotice(err, t));
      }
    }}>{t("template.share")}</button></div>
    {url && <>
      <p>{t("template.shareHelp")}</p>
      <QrImage modules={encode(url, { border: 0 }).data} label={t("template.share")} />
      <a href={url}>{t("template.open")}</a>
    </>}
  </div>;
}
