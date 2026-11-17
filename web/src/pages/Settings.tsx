// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Field, errorMessage, LiveStatus, type Notice, PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError } from "../lib/api";
import { useMe, useSession } from "../lib/session";

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageTitle>{t("settings.title")}</PageTitle>
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
  const matches = email.trim().toLowerCase() === me.user.email;

  async function del(e: FormEvent) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.del("/me", { confirmEmail: email.trim() });
      // Leave the protected page before the session state turns anonymous.
      navigate("/login", { replace: true, state: { deleted: true } });
      await refresh();
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof ApiError && err.status === 409 ? t("settings.deleteSelfFirst") : errorMessage(err, t),
      });
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
            <p>{t("settings.deleteExplain")}</p>
            <Field label={t("settings.deleteConfirmLabel")}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <LiveStatus notice={notice} onClose={() => setNotice(null)} />
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
