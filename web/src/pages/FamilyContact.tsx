// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { SnapshotLine } from "../components/SnapshotLine";
import { Field, Loading, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "@plainphone/i18n/translate";
import { ApiError } from "../lib/api";
import {
  type ContactInvitePreview,
  type ContactView,
  EXTENDED_REPLY_LENGTH,
} from "../lib/extended-family";
import {
  clearSession,
  contactRequest,
  inviteFromHash,
  storedSession,
  storeSession,
} from "../lib/family-contact";
import { formatDateTime } from "../lib/format";

type Phase =
  | { kind: "preview"; token: string; invite: ContactInvitePreview | null; busy: boolean; failed: boolean }
  | { kind: "chat"; session: string }
  | { kind: "end"; message: MessageKey; ok?: boolean };

function firstPhase(): Phase {
  const token = inviteFromHash(window.location.hash);
  if (token) return { kind: "preview", token, invite: null, busy: false, failed: false };
  const session = storedSession();
  if (session) return { kind: "chat", session };
  return { kind: "end", message: "fc.missing" };
}

/**
 * The public page of an invited family member. No account: the link in the address bar's fragment
 * is previewed, accepted or declined, and the session it returns is kept in this browser.
 */
export function FamilyContactPage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>(firstPhase);
  const end = useCallback((message: MessageKey, ok?: boolean) => setPhase({ kind: "end", message, ok }), []);

  return (
    <div className="narrow">
      <PageTitle>{t("fc.title")}</PageTitle>
      {phase.kind === "preview" && <Preview phase={phase} setPhase={setPhase} />}
      {phase.kind === "chat" && <Chat session={phase.session} onEnd={end} />}
      {phase.kind === "end" && (
        <p className={`notice ${phase.ok ? "notice-success" : "notice-error"}`} role={phase.ok ? "status" : "alert"}>
          {t(phase.message)}
        </p>
      )}
    </div>
  );
}

function Preview({ phase, setPhase }: { phase: Extract<Phase, { kind: "preview" }>; setPhase: (p: Phase) => void }) {
  const { t } = useI18n();
  const { token } = phase;

  useEffect(() => {
    let alive = true;
    contactRequest<ContactInvitePreview>("POST", "/invite", { token }).then(
      (invite) => alive && setPhase({ ...phase, invite }),
      (err) => alive && setPhase({ kind: "end", message: err instanceof ApiError && (err.status === 404 || err.status === 410) ? "fc.linkUsed" : "fc.error" }),
    );
    return () => {
      alive = false;
    };
    // Only the token decides what to preview.
  }, [token]);

  async function answer(accept: boolean) {
    setPhase({ ...phase, busy: true, failed: false });
    try {
      if (accept) {
        const { session } = await contactRequest<{ session: string }>("POST", "/accept", { token });
        storeSession(session);
        window.history.replaceState(null, "", window.location.pathname);
        setPhase({ kind: "chat", session });
      } else {
        await contactRequest("POST", "/decline", { token });
        window.history.replaceState(null, "", window.location.pathname);
        setPhase({ kind: "end", message: "fc.declined", ok: true });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setPhase({ kind: "end", message: "fc.linkUsed" });
      else setPhase({ ...phase, busy: false, failed: true });
    }
  }

  const { invite } = phase;
  if (!invite) return <Loading />;
  const names = { child: invite.childName, name: invite.contactName };
  return (
    <div className="stack">
      <p>{t("fc.invited", names)}</p>
      <p className="help">{t(invite.childApproved ? "fc.childYes" : "fc.childNotYet", names)}</p>
      <p className="help">{t("fc.privacy")}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={phase.busy} onClick={() => void answer(true)}>{t("fc.accept")}</button>
        <button type="button" className="btn btn-secondary" disabled={phase.busy} onClick={() => void answer(false)}>{t("fc.decline")}</button>
      </div>
      {phase.failed && <p role="alert">{t("fc.error")}</p>}
    </div>
  );
}

function Chat({ session, onEnd }: { session: string; onEnd: (message: MessageKey, ok?: boolean) => void }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<ContactView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const sending = useRef(false);

  const load = useCallback(async () => {
    try {
      setView(await contactRequest<ContactView>("GET", "/me", undefined, session));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        onEnd("fc.sessionGone");
      }
      // Other errors: keep what is on screen and try again at the next poll.
    }
  }, [session, onEnd]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function reply(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await contactRequest("POST", "/me/messages", { text: text.trim() }, session);
      setText("");
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        onEnd("fc.sessionGone");
        return;
      }
      setError(err instanceof ApiError && err.status === 429 ? "fc.tooMany" : "fc.sendError");
      if (err instanceof ApiError && err.status === 403) void load();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function leave() {
    if (!view || !window.confirm(t("fc.leaveConfirm", { child: view.childName }))) return;
    try {
      await contactRequest("DELETE", "/me", undefined, session);
      clearSession();
      onEnd("fc.left", true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        onEnd("fc.sessionGone");
      } else setError("fc.error");
    }
  }

  if (!view) return <Loading />;
  const names = { child: view.childName, name: view.name };
  return (
    <section className="stack" aria-label={t("fc.chatWith", names)}>
      <h2>{t("fc.chatWith", names)}</h2>
      {view.paused ? (
        <p className="notice" role="status">{t("fc.paused")}</p>
      ) : !view.canReply && <p className="notice" role="status">{t("fc.waitingChild", names)}</p>}
      {view.messages.length === 0 ? <p className="help">{t("fc.empty")}</p> : (
        <ol className="inbox-thread">
          {view.messages.map((m) => (
            <li key={m.id} className={`inbox-message ${m.from === "child" ? "inbox-child" : "inbox-parent"}`} data-message={m.id}>
              <span className="row-meta">{m.from === "child" ? view.childName : t("fc.you")} · {formatDateTime(m.sentAt, locale)}</span>
              {m.kind === "snapshot" ? <SnapshotLine location={m.location} /> : <span className="inbox-text">{m.text}</span>}
              {m.from === "contact" && <span className="row-meta">{t(m.receivedAt ? "fc.delivered" : "fc.sent")}</span>}
            </li>
          ))}
        </ol>
      )}
      {view.canReply && !view.paused && (
        <form className="stack" onSubmit={(e) => void reply(e)}>
          <Field label={t("fc.replyLabel")}>
            {(props) => (
              <input {...props} value={text} maxLength={EXTENDED_REPLY_LENGTH} autoComplete="off" onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
          <div className="actions">
            <button className="btn btn-primary" disabled={busy || !text.trim()}>{t("fc.send")}</button>
          </div>
        </form>
      )}
      {error && <p role="alert">{t(error)}</p>}
      <p className="help">{t("fc.privacy")}</p>
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={() => void leave()}>{t("fc.leave")}</button>
      </div>
    </section>
  );
}
