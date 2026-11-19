// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Field, errorMessage, LiveStatus, type Notice, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type Phone } from "../lib/api";
import { useMe, useSession } from "../lib/session";
import { NotificationsSection } from "./Notifications";

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageTitle>{t("settings.title")}</PageTitle>
      <NotificationsSection />
      <section className="section" aria-labelledby="free-promise-h">
        <h2 id="free-promise-h">{t("settings.freeTitle")}</h2>
        <p>{t("settings.freePromise")}</p>
      </section>
      <AccountSection />
    </>
  );
}

function AccountSection() {
  const { t } = useI18n();
  const me = useMe();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [blocking, setBlocking] = useState<Phone[]>([]);
  const matches = email.trim().toLowerCase() === me.user.email;

  async function del(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setNotice(null);
    setBlocking([]);
    try {
      await api.del("/me", { confirmEmail: email.trim() });
      // Leave the protected page before the session state turns anonymous.
      navigate("/login", { replace: true, state: { deleted: true } });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Name the phones that stand in the way, with a link to each.
        const ids = new Set(err.data?.selfPhoneIds ?? []);
        const { phones } = await api.get<{ phones: Phone[] }>("/phones").catch(() => ({ phones: [] as Phone[] }));
        setBlocking(phones.filter((p) => ids.has(p.id)));
        setNotice({ tone: "error", text: t("settings.deleteSelfFirst") });
      } else {
        setNotice({ tone: "error", text: errorMessage(err, t) });
      }
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="account-h">
      <h2 id="account-h">{t("settings.account")}</h2>
      <p>{t("settings.signedInAs", { email: me.user.email })}</p>
      <div className="danger-zone">
        {open ? (
          <form onSubmit={del} noValidate className="stack-sm">
            <ul>
              <li>{t("settings.deleteAccount")}</li>
              <li>{t("settings.deleteShared")}</li>
              <li>{t("settings.deletePhones")}</li>
            </ul>
            <Field label={t("settings.deleteConfirmLabel")}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <LiveStatus notice={notice} onClose={() => setNotice(null)} />
            {blocking.length > 0 && (
              <ul className="plain-list">
                {blocking.map((p) => (
                  <li key={p.id}>
                    <Link to={`/phones/${p.id}`}>{p.name}</Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button type="submit" className="btn btn-danger" disabled={busy || !matches}>
                {t("settings.deleteYes")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
                {t("app.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-link btn-link-danger" onClick={() => setOpen(true)}>
            {t("settings.delete")}
          </button>
        )}
      </div>
    </section>
  );
}
