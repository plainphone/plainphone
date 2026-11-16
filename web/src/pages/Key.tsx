// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router";
import { Field, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type ChangeResult, type KeyInput, type SelfKey } from "../lib/api";
import { formatMoney } from "../lib/format";
import { useMe } from "../lib/session";
import { usePhone } from "./Phone";

export function KeyPage() {
  const { t } = useI18n();
  const { phone } = usePhone();
  const res = useLoad(() => api.get<SelfKey>(`/phones/${phone.id}/key`), [phone.id]);
  if (phone.profile !== "self") return <Navigate to={`/phones/${phone.id}`} replace />;
  return (
    <>
      <PageTitle sub={t("key.intro")}>{t("key.title")}</PageTitle>
      <LoadGate res={res}>{(key) => <KeyForm current={key} onSaved={() => void res.reload()} />}</LoadGate>
    </>
  );
}

function KeyForm({ current, onSaved }: { current: SelfKey; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const { phone, run } = usePhone();
  const [keyType, setKeyType] = useState(current.keyType);
  const [hours, setHours] = useState(String(current.delayHours));
  const [email, setEmail] = useState(current.trustedEmail ?? "");
  const [errors, setErrors] = useState<{ hours?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKeyType(current.keyType);
    setHours(String(current.delayHours));
    setEmail(current.trustedEmail ?? "");
  }, [current]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const h = Number(hours);
    const mail = email.trim().toLowerCase();
    const next: typeof errors = {};
    if (!Number.isInteger(h) || h < 1 || h > 72) next.hours = t("key.hoursInvalid");
    if (keyType === "trusted" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail === me.user.email)) next.email = t("key.emailInvalid");
    setErrors(next);
    if (next.hours || next.email) return;
    const body: KeyInput = {
      keyType,
      delayHours: h,
      trustedEmail: keyType === "trusted" ? mail : null,
      // Pay to unlock is not offered yet: send the stored values back unchanged.
      payUnlockEnabled: current.payUnlockEnabled,
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
      <fieldset className="choices">
        <legend>{t("key.type")}</legend>
        {(["delay", "trusted"] as const).map((k) => (
          <label key={k} className="choice">
            <input type="radio" name="keyType" value={k} checked={keyType === k} onChange={() => setKeyType(k)} />
            <span>
              <span className="choice-title">{t(k === "delay" ? "key.delay" : "key.trusted")}</span>
              <span className="choice-desc">{t(k === "delay" ? "key.delayHelp" : "key.trustedHelp")}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {keyType === "delay" ? (
        <Field label={t("key.hours")} help={t("key.hoursHelp")} error={errors.hours}>
          {(p) => (
            <input {...p} className="input-short" type="number" inputMode="numeric" min={1} max={72} step={1} value={hours} onChange={(e) => setHours(e.target.value)} />
          )}
        </Field>
      ) : (
        <Field label={t("key.email")} help={t("key.emailHelp")} error={errors.email}>
          {(p) => <input {...p} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
      )}

      {/* Pay to unlock only ever applies to the delay key (D13). */}
      {keyType === "delay" && (
      <fieldset className="panel pay" disabled aria-describedby="pay-note">
        <legend>{t("key.payTitle")}</legend>
        <p className="notice notice-info" id="pay-note">
          {t("key.payNotYet")}
        </p>
        <p className="help">{t("key.payHelp")}</p>
        <label className="check">
          <input type="checkbox" checked={current.payUnlockEnabled} readOnly />
          <span>{t("key.payEnabled")}</span>
        </label>
        <div className="pay-row">
          <div className="field">
            <label htmlFor="pay-amount">{t("key.payAmount")}</label>
            <input id="pay-amount" readOnly value={formatMoney(current.payUnlockAmount, current.payUnlockCurrency, locale)} />
          </div>
          <div className="field">
            <label htmlFor="pay-recipient">{t("key.payRecipient")}</label>
            <select id="pay-recipient" value={current.payUnlockRecipient} onChange={() => undefined}>
              <option value="plainphone">{t("key.recipient.plainphone")}</option>
            </select>
          </div>
        </div>
      </fieldset>
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
