// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Link } from "react-router";
import { useI18n } from "../i18n/I18n";
import { api } from "../lib/api";
import { useActiveHousehold } from "../lib/session";
import { HouseholdPicker } from "./HouseholdPicker";
import { type SummarySettings, summaryDayName, summaryTime } from "@plainphone/shared/weekly-summary";
import { errorMessage, LiveStatus, LoadGate, type Notice, useLoad } from "./ui";

type Toggle = "enabled" | "byMail" | "byPush" | "actNowOnly";

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
};

/** The household's weekly summary: on or off, how it is delivered, when, and what may wait for it. */
export function WeeklySummarySettings() {
  const { t, locale } = useI18n();
  const household = useActiveHousehold();
  const res = useLoad(
    () => (household ? api.get<SummarySettings>(`/households/${household.id}/summary-settings`) : Promise.resolve(null)),
    [household?.id],
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  if (!household) return null;
  const hid = household.id;

  async function save(body: Partial<Omit<SummarySettings, "mailEnabled">>) {
    setSaving(true);
    try {
      const updated = await api.patch<SummarySettings>(`/households/${hid}/summary-settings`, body);
      res.setData(() => updated);
      setNotice({ tone: "success", text: t("summary.saved") });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  const toggles = (s: SummarySettings): { key: Toggle; label: "summary.enabled" | "summary.byMail" | "summary.byPush" | "summary.actNowOnly"; help: string; off?: boolean }[] => [
    { key: "enabled", label: "summary.enabled", help: t("summary.enabledHelp") },
    ...(s.enabled
      ? [
          { key: "byMail" as const, label: "summary.byMail" as const, help: s.mailEnabled ? t("summary.byMailHelp") : t("summary.mailUnavailable"), off: !s.mailEnabled },
          { key: "byPush" as const, label: "summary.byPush" as const, help: t("summary.byPushHelp") },
          { key: "actNowOnly" as const, label: "summary.actNowOnly" as const, help: t("summary.actNowOnlyHelp") },
        ]
      : []),
  ];

  return (
    <section className="section" aria-labelledby="summary-settings-h">
      <h2 id="summary-settings-h">{t("summary.settingsTitle")}</h2>
      <p>{t("summary.settingsIntro")}</p>
      <HouseholdPicker />
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(s) =>
          s && (
            <>
              <div className="stack-sm">
                {toggles(s).map(({ key, label, help, off }) => (
                  <label className="health-preference" key={key}>
                    <input
                      type="checkbox"
                      checked={s[key]}
                      disabled={saving || off}
                      aria-labelledby={`summary-${key}-label`}
                      aria-describedby={`summary-${key}-help`}
                      onChange={(e) => void save({ [key]: e.target.checked })}
                    />
                    <span id={`summary-${key}-label`}>{t(label)}</span>
                    <span className="help" id={`summary-${key}-help`}>{help}</span>
                  </label>
                ))}
              </div>
              {s.enabled && (
                <div className="inline-form summary-when">
                  <label>
                    <span>{t("summary.day")}</span>
                    <select value={s.day} disabled={saving} onChange={(e) => void save({ day: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                        <option key={d} value={d}>{summaryDayName(d, locale)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{t("summary.time")}</span>
                    <input
                      type="time"
                      value={summaryTime(s.hour, s.minute)}
                      disabled={saving}
                      onChange={(e) => {
                        const [hour, minute] = e.target.value.split(":").map(Number);
                        if (hour !== undefined && minute !== undefined && !Number.isNaN(hour) && !Number.isNaN(minute)) void save({ hour, minute });
                      }}
                    />
                  </label>
                </div>
              )}
              {s.enabled && (
                <p className="help">
                  {t("summary.zone", { zone: s.timeZone })}
                  {deviceZone() && deviceZone() !== s.timeZone && (
                    <>
                      {" "}
                      <button type="button" className="btn btn-secondary btn-small" disabled={saving} onClick={() => void save({ timeZone: deviceZone() })}>
                        {t("summary.useDeviceZone", { zone: deviceZone() })}
                      </button>
                    </>
                  )}
                </p>
              )}
              <p>
                <Link to="/summary">{t("summary.openLink")}</Link>
              </p>
            </>
          )
        }
      </LoadGate>
    </section>
  );
}
