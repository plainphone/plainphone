// SPDX-License-Identifier: Apache-2.0
import { useId, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api } from "../lib/api";
import { DEFAULT_SOS_SETTINGS, PRESS_CHOICES, type SosSettings } from "../lib/sos-options";
import { QuickMessages } from "./QuickMessages";
import { PickGroup, Switch, useLoad } from "./ui";

/** Hidden SOS and quick messages for one Child phone. Every option is a switch with one line of explanation. */
export function SosOptions({ pid }: { pid: string }) {
  const { t } = useI18n();
  const path = `/phones/${pid}/sos`;
  const res = useLoad(() => api.get<{ settings?: Partial<SosSettings> }>(path), [path]);
  const { setData } = res;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const labelId = useId();
  const feedbackId = useId();
  const settings: SosSettings = { ...DEFAULT_SOS_SETTINGS, ...res.data?.settings };

  async function save(patch: Partial<SosSettings>) {
    setSaving(true);
    setError(false);
    try {
      await api.put(path, patch);
      setData((d) => d && { ...d, settings: { ...settings, ...patch } });
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!res.data) return res.error ? <p role="status">{t("hidden.unavailable")}</p> : null;
  const anyHidden = settings.hiddenPower || settings.hiddenClock;
  return (
    <section className="section stack" aria-label={t("hidden.title")}>
      <details className="form-card sos-options">
        <summary>{t("hidden.title")}</summary>
        <div className="stack">
          <Switch label={t("hidden.power")} description={t("hidden.powerHelp")} checked={settings.hiddenPower}
            disabled={saving} onChange={(on) => void save({ hiddenPower: on })} />
          {settings.hiddenPower && (
            <div className="stack">
              <span className="switch-label" id={labelId}>{t("hidden.presses")}</span>
              <PickGroup name={`presses-${pid}`} labelledBy={labelId} value={String(settings.hiddenPresses)}
                disabled={saving}
                options={PRESS_CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
                onChange={(n) => void save({ hiddenPresses: Number(n) as SosSettings["hiddenPresses"] })} />
              <p className="help">{t("hidden.pressesHelp")}</p>
            </div>
          )}
          <Switch label={t("hidden.clock")} description={t("hidden.clockHelp")} checked={settings.hiddenClock}
            disabled={saving} onChange={(on) => void save({ hiddenClock: on })} />
          {anyHidden && (
            <div className="stack">
              <span className="switch-label" id={feedbackId}>{t("hidden.feedback")}</span>
              <PickGroup name={`feedback-${pid}`} labelledBy={feedbackId} value={settings.hiddenFeedback} disabled={saving}
                options={[{ value: "vibrate", label: t("hidden.vibrate") }, { value: "none", label: t("hidden.none") }]}
                onChange={(hiddenFeedback) => void save({ hiddenFeedback })} />
            </div>
          )}
          <p className="help">{t("hidden.visible")}</p>
          {error && <p role="alert">{t("hidden.error")}</p>}
        </div>
      </details>
      <QuickMessages pid={pid} settings={settings} saving={saving}
        onSetting={(patch) => void save(patch)} />
    </section>
  );
}
