// SPDX-License-Identifier: Apache-2.0
import { useLocalSearchParams } from "expo-router";
import { client, unwrap } from "../api/client";
import { RequireAuth } from "../components/RequireAuth";
import { Card, LoadGate, PageTitle, Screen, Stack as VStack, Text, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { useMe } from "../lib/session";
import { space } from "../lib/theme";
import {
  phoneWeekLines,
  type SummarySettings,
  summaryDayName,
  summaryRange,
  summaryTime,
  type WeeklySummary,
} from "../shared/lib/weekly-summary";

/** The last 8 weekly summaries (docs/weekly-summary.md). */
function Summary() {
  const { t, locale } = useI18n();
  const household = useMe().households[0];
  const { week } = useLocalSearchParams<{ week?: string }>();
  const res = useLoad(async () => {
    if (!household) return null;
    const path = { params: { path: { hid: household.id } } };
    const [settings, list] = await Promise.all([
      unwrap<SummarySettings>(client.GET("/households/{hid}/summary-settings", path)),
      unwrap<{ summaries: WeeklySummary[] }>(client.GET("/households/{hid}/summaries", path)),
    ]);
    // A summary opened from a mail or notification comes first.
    const summaries = [...list.summaries].sort((a, b) => Number(b.id === week) - Number(a.id === week));
    return { settings, summaries };
  }, [household?.id, week]);

  return (
    <Screen testID="summary">
      <PageTitle sub={t("summary.intro")}>{t("summary.title")}</PageTitle>
      <LoadGate res={res}>
        {(data) => data && (
          <VStack gap={space.md}>
            {data.summaries.length === 0 ? (
              <Text variant="muted">
                {data.settings.enabled
                  ? t("summary.empty", { day: summaryDayName(data.settings.day, locale), time: summaryTime(data.settings.hour, data.settings.minute) })
                  : t("summary.settingsIntro")}
              </Text>
            ) : null}
            {data.summaries.map((s) => (
              <Card key={s.id} testID={`summary-${s.id}`}>
                <Text variant="heading" accessibilityRole="header">{summaryRange(s.weekEnd, locale, t)}</Text>
                {s.data.phones.length === 0 ? <Text variant="muted">{t("summary.noPhones")}</Text> : null}
                {s.data.phones.map((p) => (
                  <VStack key={p.phoneId} gap={space.xs}>
                    <Text style={{ fontWeight: "700" }}>{p.name}</Text>
                    {phoneWeekLines(p, t).map((line) => <Text key={line}>{line}</Text>)}
                  </VStack>
                ))}
              </Card>
            ))}
          </VStack>
        )}
      </LoadGate>
    </Screen>
  );
}

export default function SummaryScreen() {
  return (
    <RequireAuth>
      <Summary />
    </RequireAuth>
  );
}
