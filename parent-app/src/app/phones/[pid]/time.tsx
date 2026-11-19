// SPDX-License-Identifier: Apache-2.0
//
// Daily screen time, the same rule as the web dashboard's "Screen time" page: one cap for all
// apps together, caps for single apps, and 15 extra minutes for today.
import { useState } from "react";
import { View } from "react-native";
import { client, unwrap } from "../../../api/client";
import type { App, ChangeResult, Limit, Locale } from "../../../api/models";
import { MoreTimeSettings } from "../../../components/MoreTimeRequests";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, Choice, errorMessage, LoadGate, PageTitle, Row, Screen, Stack as VStack, Switch, Text, useLoad } from "../../../components/ui";
import { useI18n, type TFn } from "../../../i18n/I18n";
import { space } from "../../../lib/theme";
import { formatMinutes, limitOn, todayIn, weekdayName } from "../../../shared/lib/format";
import { minuteWords } from "../../../shared/lib/ops";

/** Few, round choices, like the web dashboard. */
const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360];
const BONUS = 15;
const TOTAL = "*";

interface TimeData {
  total: Limit | null;
  apps: { packageName: string; label: string; limit: Limit }[];
  bonuses: { packageName: string; date: string; minutes: number }[];
  used: Record<string, number> | null;
}

function bonusToday(d: TimeData, pkg: string, date: string): number {
  return d.bonuses.filter((b) => b.packageName === pkg && b.date === date).reduce((n, b) => n + b.minutes, 0);
}

/** The per-day overrides without gaps, as the API wants them. */
function daysOf(limit: Limit | null | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(limit?.days ?? {}).filter((e): e is [string, number] => e[1] !== undefined));
}

/** A value set elsewhere that is not one of the round choices still shows. */
function durationOptions(current: number, w: ReturnType<typeof minuteWords>) {
  const all = DURATIONS.includes(current) ? DURATIONS : [...DURATIONS, current].sort((a, b) => a - b);
  return all.map((m) => ({ value: String(m), label: formatMinutes(m, w) }));
}

/** Weekday overrides ("Sat 3 h"), read-only, so the parent app shows the same rule scope as the web page. */
function daysSummary(limit: Limit | null | undefined, locale: Locale, t: TFn): string | null {
  const entries = Object.entries(daysOf(limit));
  if (entries.length === 0) return null;
  const w = minuteWords(t);
  return entries
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, m]) => `${weekdayName(Number(d), locale, "short")} ${m === 0 ? t("time.none").toLocaleLowerCase() : formatMinutes(m, w)}`)
    .join(", ");
}

function Used({ used, allowed }: { used: number | undefined; allowed: number }) {
  const { t } = useI18n();
  const w = minuteWords(t);
  if (used === undefined) return <Text variant="muted">{t("time.usedUnknown")}</Text>;
  return (
    <Text variant="small">
      {used >= allowed
        ? t("time.usedUp", { allowed: formatMinutes(allowed, w) })
        : t("time.used", { used: formatMinutes(used, w), allowed: formatMinutes(allowed, w) })}
    </Text>
  );
}

function TotalSection({ data, reload }: { data: TimeData; reload: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const { phone, run, notify } = usePhone();
  const w = minuteWords(t);
  const current = data.total;
  const [on, setOn] = useState(current !== null);
  const [minutes, setMinutes] = useState(String(current?.minutes ?? 120));
  const [busy, setBusy] = useState(false);
  const dirty = on ? current === null || current.minutes !== Number(minutes) : current !== null;
  const allowedToday = current ? limitOn(current, todayIn(phone.timezone).isoDay) + bonusToday(data, TOTAL, todayIn(phone.timezone).date) : 0;

  async function save() {
    setBusy(true);
    try {
      await run(
        () =>
          on
            ? unwrap<ChangeResult>(client.PUT("/phones/{pid}/time-limits/total", { params: { path: { pid: phone.id } }, body: { minutes: Number(minutes), days: daysOf(current) } }))
            : unwrap<ChangeResult>(client.DELETE("/phones/{pid}/time-limits/total", { params: { path: { pid: phone.id } } })),
        t(on ? "time.totalSaved" : "time.totalRemoved"),
      );
      await reload();
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function bonus() {
    setBusy(true);
    try {
      await run(
        () => unwrap<ChangeResult>(client.POST("/phones/{pid}/time-limits/bonus", { params: { path: { pid: phone.id } }, body: { packageName: TOTAL, minutes: BONUS } })),
        t("time.bonusGiven", { minutes: BONUS }),
      );
      await reload();
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack>
      <Text variant="heading">{t("time.totalTitle")}</Text>
      {current ? <Used used={data.used?.[TOTAL]} allowed={allowedToday} /> : null}
      {daysSummary(current, locale, t) ? <Text variant="small">{daysSummary(current, locale, t)}</Text> : null}
      <Card>
        <Switch label={t("time.totalSwitch")} help={on ? undefined : t("time.totalOff")} value={on} onValueChange={setOn} testID="time-total-switch" />
        {on ? <Choice label={t("time.perDayLabel")} value={minutes} options={durationOptions(Number(minutes), w)} onChange={setMinutes} testID="time-total-minutes" /> : null}
        <Row>
          <Button testID="time-total-save" title={busy ? t("app.saving") : t("app.save")} busy={busy} disabled={!dirty} onPress={() => void save()} />
          {current ? <Button kind="secondary" title={t("time.bonus", { minutes: BONUS })} disabled={busy} onPress={() => void bonus()} /> : null}
        </Row>
      </Card>
    </VStack>
  );
}

function AppRow({ item, data, reload }: { item: TimeData["apps"][number]; data: TimeData; reload: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const { phone, run, notify } = usePhone();
  const w = minuteWords(t);
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState(String(item.limit.minutes));
  const [busy, setBusy] = useState(false);
  const today = todayIn(phone.timezone);
  const allowed = limitOn(item.limit, today.isoDay) + bonusToday(data, item.packageName, today.date);
  const used = data.used?.[item.packageName];
  const path = { params: { path: { pid: phone.id, package: item.packageName } } };

  async function act(fn: () => Promise<ChangeResult>, text: string) {
    setBusy(true);
    try {
      await run(fn, text);
      setEditing(false);
      await reload();
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ gap: 2 }}>
        <Text variant="label">{item.label}</Text>
        <Text>{t("time.perDay", { time: formatMinutes(item.limit.minutes, w) })}</Text>
        {daysSummary(item.limit, locale, t) ? <Text variant="small">{daysSummary(item.limit, locale, t)}</Text> : null}
        {used !== undefined ? <Text variant="small">{t("time.usedShort", { used: formatMinutes(used, w), allowed: formatMinutes(allowed, w) })}</Text> : null}
      </View>
      {editing ? (
        <VStack>
          <Choice label={t("time.perDayLabel")} value={minutes} options={durationOptions(Number(minutes), w)} onChange={setMinutes} />
          <Row>
            <Button
              title={t("app.save")}
              busy={busy}
              onPress={() =>
                void act(
                  () => unwrap<ChangeResult>(client.PUT("/phones/{pid}/time-limits/apps/{package}", { ...path, body: { minutes: Number(minutes), days: daysOf(item.limit) } })),
                  t("time.appSaved", { app: item.label }),
                )
              }
            />
            <Button
              kind="secondary"
              title={t("time.removeLimit")}
              disabled={busy}
              onPress={() => void act(() => unwrap<ChangeResult>(client.DELETE("/phones/{pid}/time-limits/apps/{package}", path)), t("time.appRemoved", { app: item.label }))}
            />
            <Button kind="secondary" title={t("app.cancel")} disabled={busy} onPress={() => setEditing(false)} />
          </Row>
        </VStack>
      ) : (
        <Row>
          <Button
            kind="secondary"
            title={t("time.bonus", { minutes: BONUS })}
            accessibilityLabel={`${t("time.bonus", { minutes: BONUS })}: ${item.label}`}
            disabled={busy}
            onPress={() =>
              void act(
                () => unwrap<ChangeResult>(client.POST("/phones/{pid}/time-limits/bonus", { params: { path: { pid: phone.id } }, body: { packageName: item.packageName, minutes: BONUS } })),
                t("time.bonusGivenApp", { minutes: BONUS, app: item.label }),
              )
            }
          />
          <Button kind="secondary" title={t("app.edit")} accessibilityLabel={`${t("app.edit")}: ${item.label}`} onPress={() => setEditing(true)} />
        </Row>
      )}
    </Card>
  );
}

function AddLimit({ candidates, reload }: { candidates: App[]; reload: () => Promise<void> }) {
  const { t } = useI18n();
  const { phone, run, notify } = usePhone();
  const w = minuteWords(t);
  const [pick, setPick] = useState(candidates[0]?.packageName ?? "");
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const chosen = candidates.find((a) => a.packageName === pick) ?? candidates[0];
  if (!chosen) return null;
  async function add() {
    if (!chosen) return;
    setBusy(true);
    try {
      await run(
        () =>
          unwrap<ChangeResult>(
            client.PUT("/phones/{pid}/time-limits/apps/{package}", { params: { path: { pid: phone.id, package: chosen.packageName } }, body: { minutes: Number(minutes), days: {} } }),
          ),
        t("time.appSaved", { app: chosen.label }),
      );
      await reload();
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Choice label={t("time.app")} value={chosen.packageName} options={candidates.map((a) => ({ value: a.packageName, label: a.label }))} onChange={setPick} />
      <Choice label={t("time.perDayLabel")} value={minutes} options={durationOptions(Number(minutes), w)} onChange={setMinutes} />
      <Button testID="time-add" title={t("time.addLimit")} busy={busy} onPress={() => void add()} />
    </Card>
  );
}

function TimeScreen() {
  const { t, locale } = useI18n();
  const { phone } = usePhone();
  const res = useLoad(async () => {
    const [limits, apps] = await Promise.all([
      unwrap<TimeData>(client.GET("/phones/{pid}/time-limits", { params: { path: { pid: phone.id } } })),
      unwrap<{ apps: App[] }>(client.GET("/phones/{pid}/apps", { params: { path: { pid: phone.id } } })),
    ]);
    return { limits, apps: apps.apps };
  }, [phone.id]);
  return (
    <Screen testID="phone-time" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("time.intro")}>{t("time.title")}</PageTitle>
      <LoadGate res={res}>
        {({ limits, apps }) => {
          const limited = new Set(limits.apps.map((a) => a.packageName));
          const candidates = apps
            .filter((a) => !a.core && a.allowed && !limited.has(a.packageName))
            .sort((a, b) => a.label.localeCompare(b.label, locale));
          return (
            <>
              {phone.profile === "child" ? <MoreTimeSettings /> : null}
              {/* Re-created when the saved limit changes, so the form shows what the phone will get. */}
              <TotalSection key={JSON.stringify(limits.total)} data={limits} reload={res.reload} />
              <VStack>
                <Text variant="heading">{t("time.appsTitle")}</Text>
                <Text variant="muted">{t("time.appsHelp")}</Text>
                {limits.apps.map((item) => (
                  <AppRow key={item.packageName} item={item} data={limits} reload={res.reload} />
                ))}
                {candidates.length > 0 ? <AddLimit key={candidates.length} candidates={candidates} reload={res.reload} /> : limits.apps.length === 0 ? <Text variant="muted">{t("time.noApps")}</Text> : null}
              </VStack>
            </>
          );
        }}
      </LoadGate>
    </Screen>
  );
}

export default function PhoneTimeScreen() {
  return (
    <PhoneGate>
      <TimeScreen />
    </PhoneGate>
  );
}
