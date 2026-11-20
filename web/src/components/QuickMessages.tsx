// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "../i18n/translate";
import { ApiError, api } from "../lib/api";
import {
  MAX_QUICK_MESSAGES,
  QUICK_MESSAGE_LENGTH,
  type QuickMessage,
  type QuickMessages as QuickMessageList,
  type SosSettings,
  starterMessages,
} from "../lib/sos-options";
import { Field, Switch, useLoad } from "./ui";

function MessageForm({ initial, submitLabel, busy, onSubmit, onCancel }: {
  initial?: QuickMessage;
  submitLabel: string;
  busy: boolean;
  onSubmit: (text: string, meansSos: boolean) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial?.text ?? "");
  const [code, setCode] = useState(initial?.meansSos ?? false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (await onSubmit(text.trim(), code) && !initial) {
      setText("");
      setCode(false);
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <Field label={initial ? t("qm.editLabel", { text: initial.text }) : t("qm.new")}>
        {(props) => (
          <input {...props} value={text} maxLength={QUICK_MESSAGE_LENGTH} autoComplete="off"
            onChange={(e) => setText(e.target.value)} />
        )}
      </Field>
      <Switch label={t("qm.code")} description={t("qm.codeHelp")} checked={code} disabled={busy} onChange={setCode} />
      <div className="actions">
        <button className="btn btn-primary" disabled={busy || !text.trim()}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>{t("app.cancel")}</button>}
      </div>
    </form>
  );
}

/** The quick messages of one Child phone: switches, the list to edit, and suggestions waiting for an answer. */
export function QuickMessages({ pid, settings, saving, onSetting }: {
  pid: string;
  settings: SosSettings;
  saving: boolean;
  onSetting: (patch: Partial<SosSettings>) => void;
}) {
  const { t } = useI18n();
  const path = `/phones/${pid}/quick-messages`;
  const res = useLoad(() => api.get<QuickMessageList>(path), [path]);
  const { reload, data } = res;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const sending = useRef(false);

  const waiting = data?.suggestions.length ?? 0;
  // A suggestion waiting for an answer opens the section once, so it is not missed.
  const announced = useRef(false);
  useEffect(() => {
    if (waiting > 0 && !announced.current) {
      announced.current = true;
      setOpen(true);
    }
  }, [waiting]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (sending.current) return false;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "qm.full" : "qm.error");
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const messages = data?.messages ?? [];
  const full = messages.length >= MAX_QUICK_MESSAGES;
  const add = (text: string, meansSos = false) => run(() => api.post(path, { text, meansSos }));

  return (
    <details className="form-card sos-options" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("qm.title")}{waiting > 0 ? ` (${waiting})` : ""}</summary>
      <div className="stack">
        <Switch label={t("qm.enabled")} description={t("qm.enabledHelp")} checked={settings.quickMessagesEnabled}
          disabled={saving} onChange={(on) => onSetting({ quickMessagesEnabled: on })} />
        <Switch label={t("qm.suggest")} description={t("qm.suggestHelp")} checked={settings.quickSuggestionsEnabled}
          disabled={saving} onChange={(on) => onSetting({ quickSuggestionsEnabled: on })} />

        {Boolean(res.error) && !data && <p role="status">{t("qm.unavailable")}</p>}

        {waiting > 0 && (
          <section className="stack" aria-label={t("qm.fromChild")}>
            <h3>{t("qm.fromChild")}</h3>
            {data?.suggestions.map((s) => (
              <div key={s.id} className="item stack" data-suggestion={s.id}>
                <strong>{s.text}</strong>
                <div className="actions">
                  <button type="button" className="btn btn-primary" disabled={busy}
                    onClick={() => void run(() => api.post(`${path}/${s.id}/approve`, { meansSos: false }))}>{t("qm.approve")}</button>
                  <button type="button" className="btn btn-secondary" disabled={busy}
                    onClick={() => void run(() => api.post(`${path}/${s.id}/approve`, { meansSos: true }))}>{t("qm.approveCode")}</button>
                  <button type="button" className="btn btn-secondary" disabled={busy}
                    onClick={() => void run(() => api.post(`${path}/${s.id}/decline`))}>{t("qm.decline")}</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {data && (
          <section className="stack" aria-label={t("qm.list", { n: messages.length, max: MAX_QUICK_MESSAGES })}>
            <h3>{t("qm.list", { n: messages.length, max: MAX_QUICK_MESSAGES })}</h3>
            {messages.map((m) => editing === m.id ? (
              <MessageForm key={m.id} initial={m} submitLabel={t("app.save")} busy={busy}
                onCancel={() => setEditing(null)}
                onSubmit={async (text, meansSos) => {
                  const ok = await run(() => api.patch(`${path}/${m.id}`, { text, meansSos }));
                  if (ok) setEditing(null);
                  return ok;
                }} />
            ) : (
              <div key={m.id} className="item" data-message={m.id}>
                <div className="sos-event-heading">
                  <strong>{m.text}</strong>
                  {m.meansSos && <span className="row-meta">{t("qm.codeBadge")}</span>}
                </div>
                <div className="actions">
                  <button type="button" className="btn btn-secondary" disabled={busy} aria-label={t("qm.editLabel", { text: m.text })}
                    onClick={() => setEditing(m.id)}>{t("qm.edit")}</button>
                  <button type="button" className="btn btn-secondary" disabled={busy} aria-label={t("qm.deleteLabel", { text: m.text })}
                    onClick={() => void run(() => api.del(`${path}/${m.id}`))}>{t("qm.delete")}</button>
                </div>
              </div>
            ))}

            {messages.length === 0 && (
              <div className="stack">
                <p className="help">{t("qm.emptyIntro")}</p>
                <div className="actions">
                  {starterMessages(settings).map((key) => (
                    <button key={key} type="button" className="btn btn-secondary" disabled={busy}
                      onClick={() => void add(t(key))}>{t(key)}</button>
                  ))}
                </div>
              </div>
            )}

            {!full && editing === null && <MessageForm submitLabel={t("app.add")} busy={busy} onSubmit={add} />}
            {full && <p className="help">{t("qm.max", { max: MAX_QUICK_MESSAGES, chars: QUICK_MESSAGE_LENGTH })}</p>}
          </section>
        )}
        {error && <p role="alert">{t(error, { max: MAX_QUICK_MESSAGES })}</p>}
      </div>
    </details>
  );
}
