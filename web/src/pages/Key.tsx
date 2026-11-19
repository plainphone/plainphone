// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useState } from "react";
import { encode } from "uqr";
import { QrImage } from "./AddPhone";
import { Navigate } from "react-router";
import { errorMessage, Field, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type ChangeResult, type KeyInput, type SelfKey } from "../lib/api";
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
      <SelfTemplate phoneId={phone.id} />
      <LoadGate res={res}>{(key) => <KeyForm current={key} onSaved={() => void res.reload()} />}</LoadGate>
    </>
  );
}

function KeyForm({ current, onSaved }: { current: SelfKey; onSaved: () => void }) {
  const { t } = useI18n();
  const me = useMe();
  const { phone, run, notify } = usePhone();
  const [keyType, setKeyType] = useState(current.keyType);
  const [hours, setHours] = useState(String(current.delayHours));
  const [email, setEmail] = useState(current.trustedEmail ?? "");
  const [qrInvite, setQrInvite] = useState(current.keyType === "trusted" && !current.trustedEmail);
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [errors, setErrors] = useState<{ hours?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKeyType(current.keyType);
    setHours(String(current.delayHours));
    setEmail(current.trustedEmail ?? "");
    setQrInvite(current.keyType === "trusted" && !current.trustedEmail);
    setInviteUrl(undefined);
  }, [current]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const h = Number(hours);
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
      {current.keyType === "trusted" && !current.trustedEmail && (
        <p className={`notice ${current.trustedAccepted ? "notice-success" : "notice-info"}`}>
          {t(current.trustedAccepted ? "key.qrAccepted" : "key.qrWaiting", { hours: current.delayHours })}
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
      {keyType === "trusted" && (
        <label><input type="checkbox" checked={qrInvite} onChange={(e) => setQrInvite(e.target.checked)} /> {t("key.qrInvite")}</label>
      )}
      {keyType === "delay" ? (
        <Field label={t("key.hours")} help={t("key.hoursHelp")} error={errors.hours}>
          {(p) => (
            <select {...p} className="input-short" value={hours} onChange={(e) => setHours(e.target.value)}>
              {[...new Set([1, 6, 12, 24, 48, 72, current.delayHours])].sort((a, b) => a - b).map((value) =>
                <option key={value} value={value}>{value}</option>,
              )}
            </select>
          )}
        </Field>
      ) : !qrInvite && (
        <Field label={t("key.email")} help={t("key.emailHelp")} error={errors.email}>
          {(p) => <input {...p} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
      )}

      {current.keyType === "trusted" && !current.trustedEmail && !current.trustedAccepted && (
        <div className="stack">
          <div><button type="button" className="btn btn-secondary" onClick={async () => {
            try {
              const invite = await api.post<{ url: string }>(`/phones/${phone.id}/trusted-invite`);
              if (invite) setInviteUrl(invite.url);
            } catch (err) {
              notify({ tone: "error", text: errorMessage(err, t) });
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
        notify({ tone: "error", text: errorMessage(err, t) });
      }
    }}>{t("template.share")}</button></div>
    {url && <>
      <p>{t("template.shareHelp")}</p>
      <QrImage modules={encode(url, { border: 0 }).data} label={t("template.share")} />
      <a href={url}>{t("template.open")}</a>
    </>}
  </div>;
}
