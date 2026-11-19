// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { ResetProtectionSection } from "../components/ResetProtection";
import { HouseholdMove } from "../components/HouseholdMove";
import { errorMessage, Field, LiveStatus, LoadGate, type Notice, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type InviteResult, type Members } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useMe, useSession } from "../lib/session";

export function HouseholdPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const household = me.households[0];
  const res = useLoad(
    () => (household ? api.get<Members>(`/households/${household.id}/members`) : Promise.resolve(null)),
    [household?.id],
  );
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);

  if (!household) {
    return (
      <>
        <PageTitle>{t("house.title")}</PageTitle>
        <p className="empty-inline">{t("house.none")}</p>
      </>
    );
  }
  const hid = household.id;
  const isOwner = household.role === "owner";

  async function invite(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError(t("login.invalidEmail"));
      return;
    }
    setEmailError(undefined);
    setNotice(null);
    setLink(null);
    setSending(true);
    try {
      const r = await api.post<InviteResult>(`/households/${hid}/invites`, { email: value, locale });
      setEmail("");
      if (r.mailed) setNotice({ tone: "success", text: t("house.inviteMailed", { email: r.email }) });
      else if (r.url) setLink({ url: r.url, email: r.email });
      await res.reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields().email) setEmailError(t("login.invalidEmail"));
      else setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSending(false);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await api.del(`/households/${hid}/invites/${id}`);
      setNotice({ tone: "success", text: t("house.removed") });
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(uid: string) {
    setBusyId(uid);
    try {
      await api.del(`/households/${hid}/members/${uid}`);
      if (uid === me.user.id) {
        await refresh();
        navigate("/");
        return;
      }
      setNotice({ tone: "success", text: t("house.removed") });
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("house.lastMember") : errorMessage(err, t) });
    } finally {
      setBusyId(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "success", text: t("house.copied") });
    } catch {
      // The link is selectable in the field as a fallback.
    }
  }

  return (
    <>
      <PageTitle sub={t("house.intro")}>{household.name === "Home" ? t("house.title") : household.name}</PageTitle>
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(data) =>
          data && (
            <>
              <section className="section" aria-labelledby="members-h">
                <h2 id="members-h">{t("house.members")}</h2>
                <ul className="list item-list">
                  {data.members.map((m) => {
                    const self = m.id === me.user.id;
                    const canRemove = data.members.length > 1 && (self || isOwner);
                    return (
                      <li key={m.id} className="item">
                        <div>
                          <p className="row-title">
                            {m.email}
                            {self && <span className="muted"> ({t("house.you")})</span>}
                          </p>
                          <p className="row-meta">{t(m.role === "owner" ? "house.owner" : "house.parent")}</p>
                        </div>
                        {canRemove && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => void removeMember(m.id)}
                            disabled={busyId === m.id}
                            aria-label={self ? undefined : t("house.removeLabel", { email: m.email })}
                          >
                            {self ? t("house.leave") : t("app.remove")}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
              {data.invites.length > 0 && (
                <section className="section" aria-labelledby="invites-h">
                  <h2 id="invites-h">{t("house.invites")}</h2>
                  <ul className="list item-list">
                    {data.invites.map((i) => (
                      <li key={i.id} className="item">
                        <div>
                          <p className="row-title">{i.email}</p>
                          <p className="row-meta">{t("house.inviteExpires", { time: formatDateTime(i.expiresAt, locale) })}</p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() => void revoke(i.id)}
                          disabled={busyId === i.id}
                          aria-label={t("house.revokeLabel", { email: i.email })}
                        >
                          {t("house.revoke")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )
        }
      </LoadGate>

      <ResetProtectionSection householdId={hid} />
      {isOwner && <HouseholdMove householdId={hid} />}

      <section className="section" aria-labelledby="invite-h">
        <h2 id="invite-h">{t("house.inviteTitle")}</h2>
        <form onSubmit={invite} noValidate className="inline-form">
          <Field label={t("house.inviteEmail")} error={emailError}>
            {(p) => <input {...p} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <button type="submit" className="btn btn-primary" disabled={sending}>
            {sending ? t("login.sending") : t("house.inviteSend")}
          </button>
        </form>
        {link && (
          <div className="notice notice-warn stack-sm">
            <p>{t("house.inviteLink", { email: link.email })}</p>
            <label className="sr-only" htmlFor="invite-url">
              {t("house.copy")}
            </label>
            <input id="invite-url" className="input-url" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <div>
              <button type="button" className="btn btn-secondary" onClick={() => void copy(link.url)}>
                {t("house.copy")}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
