// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { errorMessage, type Notice } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, type Phone } from "../lib/api";
import { formatDateTime } from "@plainphone/shared/format";
import { diagnostics, helpUrl, releaseState } from "@plainphone/shared/phoneSupport";

export function ReleaseNotice({ phone }: { phone: Phone }) {
  const { t, locale } = useI18n();
  const state = releaseState(phone);
  if (!state) return null;

  const report = phone.status?.reportedAt;
  return (
    <div className={`notice notice-${state === "requested" ? "info" : "warn"} status-release`} role="status">
      <div className="stack-sm">
        <div>{t(state === "old" ? "support.releaseOld" : state === "stalled" ? "support.releaseStalled" : "phone.releasing")}</div>
        {state !== "requested" && <div>{report
          ? t("support.lastReport", { when: formatDateTime(report, locale) })
          : t("support.noReport")}</div>}
        {state === "old" && <div><a href={helpUrl(locale, true)}>{t("support.recovery")}</a></div>}
      </div>
    </div>
  );
}

export function PhoneSupport({ phone, setPhone, notify }: {
  phone: Phone;
  setPhone: (phone: Phone) => void;
  notify: (notice: Notice | null) => void;
}) {
  const { t, locale } = useI18n();
  const [saving, setSaving] = useState(false);
  const [manualCopy, setManualCopy] = useState<string>();
  const enabled = phone.supportEnabled !== false;

  async function toggle(setting: "supportEnabled" | "releaseWarningsEnabled", enabled: boolean) {
    setSaving(true);
    setManualCopy(undefined);
    try {
      setPhone(await api.patch<Phone>(`/phones/${phone.id}`, { [setting]: enabled }));
    } catch (error) {
      notify({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    const text = diagnostics(phone);
    try {
      await navigator.clipboard.writeText(text);
      setManualCopy(undefined);
      notify({ tone: "success", text: t("support.copied") });
    } catch {
      setManualCopy(text);
    }
  }

  return (
    <section className="section panel" aria-labelledby="support-h">
      <h2 id="support-h">{t("support.help")}</h2>
      <label>
        <input type="checkbox" role="switch" checked={enabled} disabled={saving}
          aria-describedby="support-hint" onChange={(event) => void toggle("supportEnabled", event.target.checked)} />{" "}
        {t("support.toggle")}
      </label>
      <p id="support-hint" className="muted">{t("support.toggleHint")}</p>
      <label>
        <input type="checkbox" role="switch" checked={phone.releaseWarningsEnabled !== false} disabled={saving}
          aria-describedby="release-warnings-hint" onChange={(event) => void toggle("releaseWarningsEnabled", event.target.checked)} />{" "}
        {t("support.releaseWarnings")}
      </label>
      <p id="release-warnings-hint" className="muted">{t("support.releaseWarningsHint")}</p>
      {enabled && (
        <div className="stack-sm">
          <a href={helpUrl(locale)}>{t("support.openHelp")}</a>
          <div><button type="button" className="btn btn-secondary" onClick={() => void copy()}>{t("support.copy")}</button></div>
          {manualCopy && <textarea aria-label={t("support.copy")} readOnly value={manualCopy}
            rows={7} onFocus={(event) => event.target.select()} />}
        </div>
      )}
    </section>
  );
}
