// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, type Phone } from "../lib/api";
import { errorMessage, type Notice, Switch } from "./ui";

type Setting = "askMoreTimeEnabled" | "limitWarningEnabled";

/** Two per-phone switches next to the time limits: may the phone ask for more time, and does it warn before a limit. */
export function TimeSwitches({ phone, setPhone, notify }: {
  phone: Phone;
  setPhone: (phone: Phone) => void;
  notify: (notice: Notice | null) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);

  async function toggle(setting: Setting, enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await api.patch<Phone>(`/phones/${phone.id}`, { [setting]: enabled }));
    } catch (error) {
      notify({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  // A missing field (an older server) counts as on, like the phone does.
  return (
    <section className="section form-card stack" aria-label={t("time.title")}>
      {/* Only a child phone can ask: on a Self phone the person holding it decides. */}
      {phone.profile === "child" && (
        <Switch
          label={t("time.askSwitch")}
          description={t("time.askHelp")}
          checked={phone.askMoreTimeEnabled !== false}
          disabled={saving}
          onChange={(on) => void toggle("askMoreTimeEnabled", on)}
        />
      )}
      <Switch
        label={t("time.warnSwitch")}
        description={t("time.warnHelp")}
        checked={phone.limitWarningEnabled !== false}
        disabled={saving}
        onChange={(on) => void toggle("limitWarningEnabled", on)}
      />
    </section>
  );
}
