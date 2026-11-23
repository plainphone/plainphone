// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, type Phone } from "../lib/api";
import { errorMessage, type Notice, Switch } from "./ui";

/** Where the "sleep outside the bedroom" recommendation comes from (docs/evidence.md). */
export const SLEEP_TIP_SOURCE = "https://www.sst.dk/udgivelser/2023/Sundhedsstyrelsens-anbefalinger-om-skaermbrug";
export const SLEEP_TIP_KEY = "pp.tip.sleepOutside";

/** A switch that saves a phone setting at once. The server and the phone treat a missing value as on. */
export function PhoneSwitch({
  phone,
  field,
  label,
  help,
  setPhone,
  notify,
}: {
  phone: Phone;
  field: "silentBedtime" | "pinApprovalEnabled";
  label: string;
  help: string;
  setPhone: (phone: Phone) => void;
  notify: (n: Notice | null) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  async function save(enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await api.patch<Phone>(`/phones/${phone.id}`, { [field]: enabled }));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Switch checked={phone[field] !== false} busy={saving} label={label} description={help}
      onChange={(enabled) => void save(enabled)} />
  );
}

function tipDismissed(): boolean {
  try {
    return localStorage.getItem(SLEEP_TIP_KEY) !== null;
  } catch {
    return false;
  }
}

/** Shown once: the phone sleeps best outside the bedroom. Dismissing it keeps it away on this browser. */
export function SleepOutsideTip() {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(tipDismissed);
  if (hidden) return null;
  function dismiss() {
    try {
      localStorage.setItem(SLEEP_TIP_KEY, "1");
    } catch {
      // private mode: it comes back next visit
    }
    setHidden(true);
  }
  return (
    <aside className="notice" aria-labelledby="sleep-tip-h">
      <div className="stack-sm">
        <h2 id="sleep-tip-h" className="h3">{t("bedtime.tipTitle")}</h2>
        <p>{t("bedtime.tipBody")}</p>
        <p>
          <a href={SLEEP_TIP_SOURCE} target="_blank" rel="noreferrer noopener">{t("bedtime.tipSource")}</a>
        </p>
      </div>
      <button type="button" className="btn btn-secondary btn-small" onClick={dismiss}>
        {t("bedtime.tipDismiss")}
      </button>
    </aside>
  );
}
