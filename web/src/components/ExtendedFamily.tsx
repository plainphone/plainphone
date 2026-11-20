// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "../i18n/translate";
import { ApiError, api, CONTACT_GROUPS, type ContactGroup } from "../lib/api";
import {
  canRenewLink,
  EXTENDED_NAME_LENGTH,
  type ExtendedContact,
  type ExtendedInvite,
  type ExtendedRoster,
  STATE_KEYS,
} from "../lib/extended-family";
import { Field, useLoad } from "./ui";

/**
 * The extended family roster of one Child phone (docs/extended-family.md): who is invited, where
 * each person stands, and a single-use link that is shown once. Parents never see the messages.
 */
export function ExtendedFamily({ pid }: { pid: string }) {
  const { t } = useI18n();
  const path = `/phones/${pid}/extended`;
  const res = useLoad(() => api.get<ExtendedRoster>(path), [path]);
  const { reload, data } = res;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [invite, setInvite] = useState<ExtendedInvite | null>(null);
  const working = useRef(false);

  /** Runs one change at a time and reloads the roster; `fail` names the message for an error. */
  async function run(fn: () => Promise<void>, fail: MessageKey) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 && fail === "ext.inviteError" ? "ext.inviteFull" : fail);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void run(async () => {
      try {
        setInvite(await api.post<ExtendedInvite>(path, { name: trimmed }));
        setName("");
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setError("ext.inviteOff");
          return;
        }
        throw err;
      }
    }, "ext.inviteError");
  }

  const renew = (c: ExtendedContact) =>
    run(async () => setInvite(await api.post<ExtendedInvite>(`${path}/${c.id}/link`)), "ext.newLinkError");
  const remove = (c: ExtendedContact) => {
    if (!window.confirm(t("ext.removeConfirm", { name: c.name }))) return;
    void run(async () => {
      await api.del(`${path}/${c.id}`);
      if (invite?.contact.id === c.id) setInvite(null);
    }, "ext.removeError");
  };
  const regroup = (c: ExtendedContact, group: ContactGroup) =>
    run(async () => void (await api.patch(`${path}/${c.id}`, { group })), "ext.groupError");

  if (!data) return res.error ? <p role="status">{t("ext.unavailable")}</p> : null;
  const anyRenewable = data.contacts.some((c) => canRenewLink(c.status));
  return (
    <section className="stack" aria-label={t("ext.title")}>
      <h3>{t("ext.title")}</h3>
      <p className="help">{t("ext.intro")}</p>
      {data.contacts.length === 0 ? (
        <p className="help">{t("ext.empty")}</p>
      ) : (
        <ul className="list" data-testid="extended-roster">
          {data.contacts.map((c) => (
            <li key={c.id} className="stack" data-contact={c.id}>
              <span className="row-title">{c.name}</span>
              <span className="row-meta" role="status">{t(STATE_KEYS[c.status], { name: c.name })}</span>
              <div className="actions">
                <label>
                  {t("group.label")}{" "}
                  <select value={c.group} disabled={busy} aria-label={t("ext.groupFor", { name: c.name })}
                    onChange={(e) => void regroup(c, e.currentTarget.value as ContactGroup)}>
                    {CONTACT_GROUPS.map((g) => <option key={g} value={g}>{t(`group.${g}` as MessageKey)}</option>)}
                  </select>
                </label>
                {canRenewLink(c.status) && (
                  <button type="button" className="btn btn-secondary btn-small" disabled={busy}
                    aria-label={`${t("ext.newLink")}: ${c.name}`} onClick={() => void renew(c)}>{t("ext.newLink")}</button>
                )}
                <button type="button" className="btn btn-secondary btn-small" disabled={busy}
                  aria-label={`${t("ext.remove")}: ${c.name}`} onClick={() => remove(c)}>{t("ext.remove")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="help">{t("ext.groupHelp")}</p>
      {anyRenewable && <p className="help">{t("ext.newLinkHelp")}</p>}
      {invite && <LinkOnce invite={invite} onDone={() => setInvite(null)} />}
      <form className="stack" onSubmit={create}>
        <Field label={t("ext.inviteName")} help={t("ext.inviteNameHelp")}>
          {(props) => (
            <input {...props} value={name} maxLength={EXTENDED_NAME_LENGTH} autoComplete="off"
              onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="actions">
          <button className="btn btn-primary" disabled={busy || !name.trim()}>{t("ext.invite")}</button>
        </div>
        {error && <p role="alert">{t(error)}</p>}
      </form>
    </section>
  );
}

/** The single-use link, shown once: it is gone when the parent presses Done or the page reloads. */
function LinkOnce({ invite, onDone }: { invite: ExtendedInvite; onDone: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<boolean | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="notice stack-sm" role="region" aria-label={t("ext.linkFor", { name: invite.contact.name })}>
      <p><strong>{t("ext.linkFor", { name: invite.contact.name })}</strong></p>
      <p>{t("ext.linkOnce", { name: invite.contact.name })}</p>
      <p><input readOnly value={invite.link} aria-label={t("ext.linkFor", { name: invite.contact.name })}
        onFocus={(e) => e.currentTarget.select()} /></p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>{t("ext.copy")}</button>
        <button type="button" className="btn btn-secondary" onClick={onDone}>{t("ext.done")}</button>
      </div>
      {copied === true && <p role="status">{t("ext.copied")}</p>}
      {copied === false && <p role="alert">{t("ext.copyFailed")}</p>}
    </div>
  );
}
