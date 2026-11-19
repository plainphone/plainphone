// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { Field, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type ChangeResult, type Contact } from "../lib/api";
import { ContactSuggestions } from "./ContactSuggestions";
import { usePhone } from "./Phone";

/** Same rule as the server: + and 7 to 15 digits, spaces, dashes and brackets ignored. */
export function cleanNumber(raw: string): string {
  return raw.trim().replace(/[\s()-]/g, "");
}
export const NUMBER_RE = /^\+[1-9]\d{6,14}$/;

type ChildContactSettings = {
  suggestDeviceContacts?: boolean;
  lightContactRestriction?: boolean;
};

export function ContactsPage() {
  const { t } = useI18n();
  const { phone, run, pending, refreshRuleReceipt } = usePhone();
  const self = phone.profile === "self";
  const lightChild = !self && phone.mode === "light";
  const res = useLoad(() => api.get<ChildContactSettings & { contacts: Contact[]; selfScheduleContacts?: boolean | null }>(
    `/phones/${phone.id}/contacts`,
  ), [phone.id]);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [errors, setErrors] = useState<{ name?: string; number?: string }>({});
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [sosError, setSosError] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [settingsSummary, setSettingsSummary] = useState("");

  async function changeSettings(settings: ChildContactSettings) {
    setSavingSettings(true);
    setSettingsFailed(false);
    setSettingsSummary("");
    try {
      const { before, after } = await api.patch<{
        before: Required<ChildContactSettings>;
        after: Required<ChildContactSettings>;
      }>(`/phones/${phone.id}/contacts`, settings);
      const restriction = settings.lightContactRestriction !== undefined;
      const key = restriction ? "lightContactRestriction" : "suggestDeviceContacts";
      setSettingsSummary(t("contacts.settingChanged", {
        setting: t(restriction ? "contacts.lightRestrict" : "contacts.suggestFromPhone"),
        from: t(before[key] ? "contacts.settingOn" : "contacts.settingOff"),
        to: t(after[key] ? "contacts.settingOn" : "contacts.settingOff"),
      }));
      res.setData((data) => data && { ...data, ...after });
      if (before[key] !== after[key]) refreshRuleReceipt();
    } catch {
      setSettingsFailed(true);
    } finally {
      setSavingSettings(false);
    }
  }

  const waitingSchedule = pending.some((change) => change.op.type === "contact.schedule");
  async function changeSchedule(restricted: boolean) {
    setSavingSchedule(true);
    try {
      const result = await run(
        () => api.put<ChangeResult>(`/phones/${phone.id}/contact-schedule`, { restricted }),
        t(restricted ? "contacts.restrictOn" : "contacts.restrictOff"),
      );
      if (result?.status === "applied") await res.reload();
    } finally {
      setSavingSchedule(false);
    }
  }

  const waitingAdds = pending.flatMap((c) => (c.op.type === "contact.add" ? [c.op] : []));

  async function add(e: FormEvent) {
    e.preventDefault();
    const n = cleanNumber(number);
    const next: typeof errors = {};
    if (!name.trim()) next.name = t("contacts.nameRequired");
    if (!NUMBER_RE.test(n)) next.number = t("contacts.numberInvalid");
    setErrors(next);
    if (next.name || next.number) return;
    setSaving(true);
    try {
      const r = await run(
        () => api.post<ChangeResult>(`/phones/${phone.id}/contacts`, { name: name.trim(), number: n }),
        t("contacts.added", { name: name.trim() }),
      );
      if (r) {
        setName("");
        setNumber("");
        if (r.status === "applied") await res.reload();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const f = err.fields();
        setErrors({ name: f.name ? t("contacts.nameRequired") : undefined, number: f.number ? t("contacts.numberInvalid") : undefined });
      }
    } finally {
      setSaving(false);
    }
  }

  async function markParent(c: Contact) {
    setMarking(true);
    setSosError(false);
    try {
      await api.put(`/phones/${phone.id}/contacts/${c.id}/sos-parent`, { enabled: !c.sosParent });
      await res.reload();
    } catch {
      setSosError(true);
    } finally {
      setMarking(false);
    }
  }

  async function remove(c: Contact) {
    setRemoving(c.id);
    const r = await run(() => api.del<ChangeResult>(`/phones/${phone.id}/contacts/${c.id}`), t("contacts.removed"));
    if (r?.status === "applied") res.setData((data) => data && { ...data, contacts: data.contacts.filter((x) => x.id !== c.id) });
    setRemoving(null);
  }

  return (
    <>
      <PageTitle sub={self || lightChild ? undefined : t("contacts.intro")}>{t(self ? "contacts.favourites" : "contacts.title")}</PageTitle>
      {sosError && <p role="alert">{t("sos.error")}</p>}
      {!self && <p className="help">{t("contacts.otherApps")}</p>}

      <LoadGate res={res}>
        {({ contacts: list, selfScheduleContacts, suggestDeviceContacts, lightContactRestriction }) => (
          <>
            {!self && (
              <>
                {settingsFailed && <p role="alert">{t("contacts.settingsError")}</p>}
                <div role="status">{settingsSummary}</div>
                {lightChild && (
                  <>
                    <label className="item">
                      <span>{t("contacts.lightRestrict")}</span>
                      <input type="checkbox" checked={lightContactRestriction === true}
                        disabled={savingSettings || lightContactRestriction === undefined}
                        onChange={(event) => void changeSettings({ lightContactRestriction: event.currentTarget.checked })} />
                    </label>
                    {lightContactRestriction && list.length === 0 && (
                      <p role="alert">{t("contacts.lightEmptyWarning")}</p>
                    )}
                  </>
                )}
                <label className="item">
                  <span>{t("contacts.suggestFromPhone")}</span>
                  <input type="checkbox" checked={suggestDeviceContacts === true} aria-describedby="contact-sharing-help"
                    disabled={savingSettings || suggestDeviceContacts === undefined}
                    onChange={(event) => void changeSettings({ suggestDeviceContacts: event.currentTarget.checked })} />
                </label>
                <p className="help" id="contact-sharing-help">{t("contacts.suggestSharing")}</p>
              </>
            )}
            {self && (
              <>
                <p className="help">{t(selfScheduleContacts === null ? "contacts.selfLegacyIntro" : "contacts.selfIntro")}</p>
                {selfScheduleContacts === null ? (
                  <div className="actions">
                    <button type="button" className="btn btn-secondary" disabled={savingSchedule || waitingSchedule}
                      onClick={() => void changeSchedule(true)}>{t("contacts.restrictScheduled")}</button>
                    <button type="button" className="btn btn-secondary" disabled={savingSchedule || waitingSchedule}
                      onClick={() => void changeSchedule(false)}>{t("contacts.allowEveryone")}</button>
                  </div>
                ) : (
                  <label className="item">
                    <span>{t("contacts.restrictScheduled")}</span>
                    <input type="checkbox" checked={selfScheduleContacts === true} disabled={savingSchedule || waitingSchedule}
                      onChange={(event) => void changeSchedule(event.currentTarget.checked)} />
                  </label>
                )}
              </>
            )}
            {waitingSchedule && <p className="help" role="status">{t("pending.waitingTag")}</p>}
            {list.length === 0 && waitingAdds.length === 0 ? (
                <p className="empty-inline">{t(self ? "contacts.noFavourites" : lightChild && !lightContactRestriction ? "contacts.emptyUnrestricted" : "contacts.empty")}</p>
              ) : (
                <ul className="list contacts-list">
                  {list.map((c) => (
                    <li key={c.id} className="item">
                      <div>
                        <p className="row-title">{c.name}</p>
                        <p className="row-meta number">{c.number}</p>
                        {!self && <label>
                          <input type="checkbox" checked={Boolean(c.sosParent)} disabled={marking} onChange={() => void markParent(c)} />
                          {t("sos.mark")}
                        </label>}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => void remove(c)}
                        disabled={removing === c.id}
                        aria-label={t("contacts.removeLabel", { name: c.name })}
                      >
                        {t("app.remove")}
                      </button>
                    </li>
                  ))}
                  {waitingAdds.map((op) => (
                    <li key={op.number} className="item item-waiting">
                      <div>
                        <p className="row-title">{op.name}</p>
                        <p className="row-meta number">{op.number}</p>
                      </div>
                      <span className="tag tag-waiting">{t("pending.waitingTag")}</span>
                    </li>
                  ))}
                </ul>
            )}
          </>
        )}
      </LoadGate>

      {!self && res.data?.suggestDeviceContacts && <ContactSuggestions phoneId={phone.id} onApproved={async () => { await res.reload(); }} />}

      <section className="section" aria-labelledby="add-contact">
        <h2 id="add-contact">{t(self ? "contacts.addFavourite" : "contacts.add")}</h2>
        <form onSubmit={add} noValidate className="stack contact-form">
          <Field label={t("contacts.name")} error={errors.name}>
            {(p) => <input {...p} name="name" maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t("contacts.number")} help={t("contacts.numberHelp")} error={errors.number}>
            {(p) => (
              <input
                {...p}
                name="number"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="+45"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            )}
          </Field>
          <div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t("app.saving") : t(self ? "contacts.addFavourite" : "contacts.add")}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
