// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, type Phone } from "../lib/api";
import { appUpdateLines } from "../lib/app-updates";
import { errorMessage, type Notice, Switch } from "./ui";

/**
 * Strong mode: updates of approved apps (docs/policies.md, "App updates"). The nightly switch,
 * "Update apps now" and what the last window did.
 */
export function AppUpdates({ phone, setPhone, notify }: {
  phone: Phone;
  setPhone: (phone: Phone) => void;
  notify: (notice: Notice | null) => void;
}) {
  const { t, locale } = useI18n();
  const [saving, setSaving] = useState(false);
  const [requested, setRequested] = useState(false);
  if (phone.mode !== "strong") return null;
  const report = phone.status?.appUpdates;
  // A request newer than the last window the phone reported is still on its way.
  const reportedAt = report?.openedAt ?? report?.closedAt;
  const waiting = requested || (phone.appUpdatesRequestedAt != null &&
    (!reportedAt || Date.parse(reportedAt) < Date.parse(phone.appUpdatesRequestedAt)));

  async function toggle(enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await api.patch<Phone>(`/phones/${phone.id}`, { appUpdatesEnabled: enabled }));
    } catch (error) {
      notify({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  async function updateNow() {
    setSaving(true);
    try {
      await api.post(`/phones/${phone.id}/app-updates`);
      setRequested(true);
    } catch (error) {
      notify({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section form-card stack" aria-labelledby="app-updates-h">
      <h2 id="app-updates-h">{t("appUpdates.title")}</h2>
      <Switch
        label={t("appUpdates.switch")}
        description={t("appUpdates.help")}
        checked={phone.appUpdatesEnabled !== false}
        disabled={saving}
        onChange={(on) => void toggle(on)}
      />
      <div role="status">
        {appUpdateLines(report, locale).map((line) => (
          <p key={line.key} className={line.tone === "warn" ? "notice notice-warn" : "help"}>{t(line.key, line.params)}</p>
        ))}
        {waiting && <p className="help">{t("appUpdates.requested")}</p>}
      </div>
      <div>
        <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void updateNow()}>
          {t("appUpdates.now")}
        </button>
      </div>
    </section>
  );
}
