// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api } from "../lib/api";
import { useMe } from "../lib/session";
import {
  phoneWeekLines,
  type SummarySettings,
  summaryDayName,
  summaryFirstDate,
  summaryRange,
  summaryTime,
  type WeeklySummary,
} from "../lib/weekly-summary";

/** The last 8 weekly summaries (docs/weekly-summary.md). A mail or push links here with ?week=. */
export function SummaryPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const household = me.households[0];
  const [params] = useSearchParams();
  const open = params.get("week");
  const res = useLoad(async () => {
    if (!household) return null;
    const [settings, list] = await Promise.all([
      api.get<SummarySettings>(`/households/${household.id}/summary-settings`),
      api.get<{ summaries: WeeklySummary[]; firstSummaryOn?: string | null }>(`/households/${household.id}/summaries`),
    ]);
    return { settings, summaries: list.summaries, firstSummaryOn: list.firstSummaryOn ?? null };
  }, [household?.id]);

  const loaded = res.data?.summaries.length;
  useEffect(() => {
    if (open && loaded) document.getElementById(`week-${open}`)?.scrollIntoView({ block: "start" });
  }, [open, loaded]);

  return (
    <>
      <PageTitle sub={t("summary.intro")}>{t("summary.title")}</PageTitle>
      <LoadGate res={res}>
        {(data) =>
          data && (
            <>
              {data.summaries.length === 0 && (
                <p className="empty-inline">
                  {!data.settings.enabled
                    ? t("summary.settingsIntro")
                    : data.firstSummaryOn
                      ? t("summary.firstOn", { date: summaryFirstDate(data.firstSummaryOn, locale) })
                      : t("summary.empty", { day: summaryDayName(data.settings.day, locale), time: summaryTime(data.settings.hour, data.settings.minute) })}
                </p>
              )}
              {data.summaries.map((s) => (
                <section key={s.id} id={`week-${s.id}`} className="section summary-week" aria-labelledby={`week-${s.id}-h`}>
                  <h2 id={`week-${s.id}-h`}>{summaryRange(s.weekEnd, locale, t)}</h2>
                  {s.data.phones.length === 0 && <p className="muted">{t("summary.noPhones")}</p>}
                  {s.data.phones.map((p) => (
                    <div key={p.phoneId} className="summary-phone">
                      <h3>{p.name}</h3>
                      <ul className="summary-lines">
                        {phoneWeekLines(p, t).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
              <p>
                <Link to="/settings">{t("summary.settingsTitle")}</Link>
              </p>
            </>
          )
        }
      </LoadGate>
    </>
  );
}
