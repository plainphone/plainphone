// SPDX-License-Identifier: Apache-2.0
import { useRouter } from "expo-router";
import { useState } from "react";
import { client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import { useMe } from "../lib/session";
import { type SummarySettings, summaryDayName, summaryTime } from "../shared/lib/weekly-summary";
import { Button, Card, Choice, errorMessage, LiveStatus, LoadGate, type NoticeValue, Switch, Text, useLoad } from "./ui";

/** Times to choose from; a time set elsewhere (the web dashboard) is kept and shown as well. */
const TIMES = ["08:00", "12:00", "16:00", "18:00", "20:00"];

/** The household's weekly summary: on or off, how it is delivered, when, and what may wait for it. */
export function WeeklySummarySettings() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const household = useMe().households[0];
  const res = useLoad<SummarySettings | null>(
    () => household
      ? unwrap<SummarySettings>(client.GET("/households/{hid}/summary-settings", { params: { path: { hid: household.id } } }))
      : Promise.resolve(null),
    [household?.id],
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  if (!household) return null;
  const hid = household.id;

  async function save(body: Partial<Omit<SummarySettings, "mailEnabled">>) {
    setSaving(true);
    try {
      const updated = await unwrap<SummarySettings>(client.PATCH("/households/{hid}/summary-settings", { params: { path: { hid } }, body }));
      res.setData(() => updated);
      setNotice({ tone: "success", text: t("summary.saved") });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card testID="summary-settings">
      <Text variant="heading">{t("summary.settingsTitle")}</Text>
      <Text variant="muted">{t("summary.settingsIntro")}</Text>
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(s) => s && (
          <>
            <Switch label={t("summary.enabled")} help={t("summary.enabledHelp")} value={s.enabled} disabled={saving}
              onValueChange={(enabled) => void save({ enabled })} testID="summary-enabled" />
            {s.enabled ? (
              <>
                <Switch label={t("summary.byMail")} help={s.mailEnabled ? t("summary.byMailHelp") : t("summary.mailUnavailable")}
                  value={s.byMail} disabled={saving || !s.mailEnabled} onValueChange={(byMail) => void save({ byMail })} testID="summary-mail" />
                <Switch label={t("summary.byPush")} help={t("summary.byPushHelp")} value={s.byPush} disabled={saving}
                  onValueChange={(byPush) => void save({ byPush })} testID="summary-push" />
                <Switch label={t("summary.actNowOnly")} help={t("summary.actNowOnlyHelp")} value={s.actNowOnly} disabled={saving}
                  onValueChange={(actNowOnly) => void save({ actNowOnly })} testID="summary-act-now" />
                <Choice<string>
                  label={t("summary.day")}
                  value={String(s.day)}
                  disabled={saving}
                  onChange={(day) => void save({ day: Number(day) })}
                  options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: summaryDayName(d, locale) }))}
                />
                <Choice<string>
                  label={t("summary.time")}
                  value={summaryTime(s.hour, s.minute)}
                  disabled={saving}
                  onChange={(time) => {
                    const [hour, minute] = time.split(":").map(Number);
                    void save({ hour: hour!, minute: minute! });
                  }}
                  options={[...new Set([...TIMES, summaryTime(s.hour, s.minute)])].sort().map((value) => ({ value, label: value }))}
                />
                <Text variant="small">{t("summary.zone", { zone: s.timeZone })}</Text>
              </>
            ) : null}
            <Button kind="secondary" title={t("summary.openLink")} onPress={() => router.push("/summary")} testID="open-summary" />
          </>
        )}
      </LoadGate>
    </Card>
  );
}
