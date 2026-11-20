// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { useLiveRefresh } from "../lib/live";
import type { MessageKey } from "../i18n/translate";
import { ApiError, api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { type FamilyInboxThread, familyState, REPLY_LENGTH, type SosSettings } from "../lib/sos-options";
import { Field, Switch, useLoad } from "./ui";

/** The name a parent signs replies with, kept on this device only. */
const NAME_KEY = "pp.inboxName"; // a display name, not a credential

/**
 * The family inbox of one Child phone (docs/family-inbox.md): its switches, the thread and a short
 * reply. Every switch is off for a new phone; the child's phone shows which ones are on.
 */
export function FamilyInbox({ pid, settings, saving, onSetting }: {
  pid: string;
  settings: SosSettings;
  saving: boolean;
  onSetting: (patch: Partial<SosSettings>) => void;
}) {
  const { t } = useI18n();
  return (
    <details className="form-card sos-options" open={settings.familyInbox || undefined}>
      <summary>{t("inbox.title")}</summary>
      <div className="stack">
        <Switch label={t("inbox.enabled")} description={t("inbox.enabledHelp")} checked={settings.familyInbox}
          disabled={saving} onChange={(on) => onSetting({ familyInbox: on })} />
        <Switch label={t("inbox.checkIns")}
          description={settings.familyInbox ? t("inbox.checkInsHelp") : `${t("inbox.checkInsHelp")} ${t("inbox.needsInbox")}`}
          checked={settings.checkIns} disabled={saving} onChange={(on) => onSetting({ checkIns: on })} />
        <p className="help">{t("inbox.quickNote")}</p>
        <p className="help">{t("inbox.privacy")}</p>
        {settings.familyInbox && <Thread pid={pid} />}
      </div>
    </details>
  );
}

function Thread({ pid }: { pid: string }) {
  const { t, locale } = useI18n();
  const path = `/phones/${pid}/inbox`;
  const res = useLoad(() => api.get<FamilyInboxThread>(path), [path]);
  const { reload, data } = res;
  const [text, setText] = useState("");
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const sending = useRef(false);

  useLiveRefresh(["inbox.message"], pid, reload, 30_000);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const signed = name.trim();
      if (signed) localStorage.setItem(NAME_KEY, signed);
      else localStorage.removeItem(NAME_KEY);
      await api.post(path, { text: text.trim(), name: signed || undefined });
      setText("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "inbox.off" : "inbox.error");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (!data) return res.error ? <p role="status">{t("inbox.unavailable")}</p> : null;
  return (
    <section className="stack" aria-label={t("inbox.title")}>
      {data.messages.length === 0 && <p className="help">{t("inbox.empty")}</p>}
      {data.messages.length > 0 && (
        <ol className="inbox-thread">
          {data.messages.map((m) => {
            const state = familyState(m);
            const who = m.from === "child" ? t("inbox.child") : m.author || t("inbox.parent");
            return (
              <li key={m.id} className={`inbox-message inbox-${m.from}`} data-message={m.id}>
                <span className="row-meta">{who} · {formatDateTime(m.sentAt, locale)}</span>
                <span className="inbox-text">{m.kind === "checkin" ? t("inbox.checkIn") : m.text}</span>
                <span className="row-meta">
                  {t(state.key, state.at ? { time: formatDateTime(state.at, locale) } : undefined)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <form className="stack" onSubmit={(e) => void send(e)}>
        <Field label={t("inbox.replyLabel")}>
          {(props) => (
            <input {...props} value={text} maxLength={REPLY_LENGTH} autoComplete="off" onChange={(e) => setText(e.target.value)} />
          )}
        </Field>
        <Field label={t("inbox.replyName")} help={t("inbox.replyNameHelp")} optional>
          {(props) => (
            <input {...props} value={name} maxLength={60} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="actions">
          <button className="btn btn-primary" disabled={busy || !text.trim()}>{t("inbox.send")}</button>
        </div>
        {error && <p role="alert">{t(error)}</p>}
      </form>
    </section>
  );
}
