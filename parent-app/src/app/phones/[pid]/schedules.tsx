// SPDX-License-Identifier: Apache-2.0
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { App, ChangeResult, Schedule, ScheduleInput, ScheduleKind } from "../../../api/models";
import { PhoneSwitch, SleepOutsideTip } from "../../../components/BedtimeSettings";
import { Chip, CheckRow } from "../../../components/parts";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, Choice, errorMessage, Field, LoadGate, Notice, PageTitle, Row, Screen, Stack as VStack, Text, useLoad } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { space } from "../../../lib/theme";
import { crossesMidnight, hhmmToMinutes, minutesToHHMM, weekdayName } from "../../../shared/lib/format";
import { formatDays, formatWindow, kindLabel } from "../../../shared/lib/ops";

interface Data {
  schedules: Schedule[];
  apps: App[];
}

function SchedulesList() {
  const { t, locale } = useI18n();
  const { phone, run, appLabel, notify } = usePhone();
  const router = useRouter();
  const res = useLoad(async (): Promise<Data> => {
    const [s, a] = await Promise.all([
      unwrap<{ schedules: Schedule[] }>(client.GET("/phones/{pid}/schedules", { params: { path: { pid: phone.id } } })),
      unwrap<{ apps: App[] }>(client.GET("/phones/{pid}/apps", { params: { path: { pid: phone.id } } })),
    ]);
    return { schedules: s.schedules, apps: a.apps };
  }, [phone.id]);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(s: Schedule) {
    setDeleting(s.id);
    try {
      const r = await run(
        () => unwrap<ChangeResult>(client.DELETE("/phones/{pid}/schedules/{sid}", { params: { path: { pid: phone.id, sid: s.id } } })),
        t("sched.deleted"),
      );
      if (r?.status === "applied") await res.reload();
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setDeleting(null);
      setConfirming(null);
    }
  }

  return (
    <Screen testID="phone-schedules" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("sched.intro")}>{t("sched.title")}</PageTitle>
      {phone.modesEnabled ? (
        <Notice tone="info" text={t("modes.schedNote")}>
          <Button
            testID="sched-to-modes"
            kind="secondary"
            title={t("modes.title")}
            onPress={() => router.push({ pathname: "/phones/[pid]/modes", params: { pid: phone.id } })}
          />
        </Notice>
      ) : null}
      <SleepOutsideTip />
      <Card>
        <PhoneSwitch field="silentBedtime" label={t("bedtime.silent")} help={t("bedtime.silentHelp")} />
      </Card>
      <LoadGate res={res}>
        {({ schedules, apps }) => (
          <>
            {schedules.length === 0 && editing === null ? <Text variant="muted">{t("sched.empty")}</Text> : null}
            {schedules.length > 0 ? (
              <VStack gap={space.sm}>
                {schedules.map((s) => {
                  if (editing !== "new" && editing?.id === s.id) {
                    return (
                      <Editor
                        key={s.id}
                        initial={s}
                        apps={apps}
                        onDone={async (saved) => {
                          setEditing(null);
                          if (saved) await res.reload();
                        }}
                      />
                    );
                  }
                  const kind = kindLabel(s.kind, t);
                  const days = formatDays(s.days, locale, t);
                  return (
                    <Card key={s.id} style={{ gap: space.sm }}>
                      <View style={{ gap: 2 }}>
                        <Text variant="label">{kind}</Text>
                        <Text>
                          {days}, {formatWindow(s, locale, t)}
                          {crossesMidnight(s.startMinute, s.endMinute) ? ` (${t("sched.nextDay").replace(/\.$/, "").toLocaleLowerCase(locale)})` : ""}
                        </Text>
                        <Text variant="small">
                          {s.allowedPackages.length === 0 ? t("sched.onlyCore") : s.allowedPackages.map(appLabel).join(", ")}
                        </Text>
                      </View>
                      {confirming === s.id ? (
                        <VStack>
                          <Text accessibilityLiveRegion="polite">{t("sched.deleteConfirm", { kind: kind.toLocaleLowerCase(locale) })}</Text>
                          <Row>
                            <Button
                              kind="danger"
                              title={t("app.confirmDelete")}
                              busy={deleting === s.id}
                              onPress={() => void remove(s)}
                            />
                            <Button kind="secondary" title={t("app.cancel")} disabled={deleting === s.id} onPress={() => setConfirming(null)} />
                          </Row>
                        </VStack>
                      ) : (
                        <Row>
                          <Button
                            kind="secondary"
                            title={t("app.edit")}
                            accessibilityLabel={`${t("app.edit")}: ${kind}, ${days}`}
                            disabled={editing !== null}
                            onPress={() => setEditing(s)}
                          />
                          <Button
                            kind="secondary"
                            title={t("app.delete")}
                            accessibilityLabel={`${t("app.delete")}: ${kind}, ${days}`}
                            disabled={editing !== null}
                            onPress={() => setConfirming(s.id)}
                          />
                        </Row>
                      )}
                    </Card>
                  );
                })}
              </VStack>
            ) : null}
            {editing === "new" ? (
              <Editor
                apps={apps}
                onDone={async (saved) => {
                  setEditing(null);
                  if (saved) await res.reload();
                }}
              />
            ) : (
              <Button testID="sched-add" title={t("sched.add")} disabled={editing !== null} onPress={() => setEditing("new")} />
            )}
          </>
        )}
      </LoadGate>
    </Screen>
  );
}

function toggled<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

function Editor({ initial, apps, onDone }: { initial?: Schedule; apps: App[]; onDone: (saved: boolean) => void | Promise<void> }) {
  const { t, locale } = useI18n();
  const { phone, run } = usePhone();
  const [kind, setKind] = useState<ScheduleKind>(initial?.kind ?? "school");
  const [days, setDays] = useState<Set<number>>(new Set(initial?.days ?? [1, 2, 3, 4, 5]));
  const [start, setStart] = useState(minutesToHHMM(initial?.startMinute ?? 8 * 60));
  const [end, setEnd] = useState(minutesToHHMM(initial?.endMinute ?? 15 * 60));
  const [allowed, setAllowed] = useState<Set<string>>(new Set(initial?.allowedPackages ?? []));
  const [errors, setErrors] = useState<{ days?: string; start?: string; end?: string }>({});
  const [saving, setSaving] = useState(false);
  const choosable = apps.filter((a) => !a.core).sort((a, b) => a.label.localeCompare(b.label, locale));

  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  const nextDay = s !== null && e !== null && s !== e && crossesMidnight(s, e);

  function pickKind(k: ScheduleKind) {
    setKind(k);
    // Sensible starting times for a new bedtime; never overwrite an edit.
    if (!initial && k === "bedtime" && start === "08:00" && end === "15:00") {
      setStart("21:00");
      setEnd("07:00");
      setDays(new Set([1, 2, 3, 4, 5, 6, 7]));
    }
  }

  async function submit() {
    const next: typeof errors = {};
    if (days.size === 0) next.days = t("sched.noDays");
    if (s === null) next.start = t("sched.badTime");
    if (e === null) next.end = t("sched.badTime");
    if (s !== null && e !== null && s === e) next.end = t("sched.sameTime");
    setErrors(next);
    if (next.days || next.start || next.end || s === null || e === null) return;
    const body: ScheduleInput = {
      kind,
      days: [...days].sort((a, b) => a - b),
      startMinute: s,
      endMinute: e,
      allowedPackages: [...allowed].filter((p) => choosable.some((a) => a.packageName === p)),
    };
    setSaving(true);
    try {
      const r = await run(
        () =>
          initial
            ? unwrap<ChangeResult>(client.PUT("/phones/{pid}/schedules/{sid}", { params: { path: { pid: phone.id, sid: initial.id } }, body }))
            : unwrap<ChangeResult>(client.POST("/phones/{pid}/schedules", { params: { path: { pid: phone.id } }, body })),
        t("app.saved"),
      );
      if (r) await onDone(r.status === "applied");
    } catch (err) {
      if (err instanceof ApiError) {
        const f = err.fields();
        setErrors({ days: f.days ? t("sched.noDays") : undefined, end: f[""] || f.endMinute ? t("sched.sameTime") : undefined });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">{initial ? `${t("sched.editTitle")}: ${kindLabel(initial.kind, t)}` : t("sched.newTitle")}</Text>
      <Choice<ScheduleKind>
        label={t("sched.kind")}
        value={kind}
        onChange={pickKind}
        options={[
          { value: "school", label: kindLabel("school", t) },
          { value: "bedtime", label: kindLabel("bedtime", t) },
        ]}
      />
      <View style={{ gap: space.sm }}>
        <Text variant="label">{t("sched.days")}</Text>
        <Row gap={space.xs}>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <Chip
              key={d}
              testID={`day-${d}`}
              label={weekdayName(d, locale, "short").replace(/\.$/, "")}
              accessibilityLabel={weekdayName(d, locale, "long")}
              checked={days.has(d)}
              onPress={() => setDays(toggled(days, d))}
            />
          ))}
        </Row>
        {errors.days ? (
          <Text variant="error" accessibilityLiveRegion="polite">
            {errors.days}
          </Text>
        ) : null}
      </View>
      <Field
        testID="sched-start"
        label={t("sched.start")}
        help={t("native.timeHelp")}
        error={errors.start}
        value={start}
        onChangeText={setStart}
        placeholder="08:00"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        autoComplete="off"
        autoCorrect={false}
      />
      <Field
        testID="sched-end"
        label={t("sched.end")}
        error={errors.end}
        value={end}
        onChangeText={setEnd}
        placeholder="15:00"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        autoComplete="off"
        autoCorrect={false}
      />
      {nextDay ? <Text variant="small">{t("sched.nextDay")}</Text> : null}
      <View style={{ gap: space.xs }}>
        <Text variant="label">{t("sched.allowedApps")}</Text>
        <Text variant="small">{t("sched.allowedHelp")}</Text>
        {choosable.length === 0 ? (
          <Text variant="muted">{t("sched.noApps")}</Text>
        ) : (
          choosable.map((a) => (
            <CheckRow
              key={a.packageName}
              testID={`allow-${a.packageName}`}
              label={a.label}
              checked={allowed.has(a.packageName)}
              onToggle={() => setAllowed(toggled(allowed, a.packageName))}
            />
          ))
        )}
      </View>
      <Row>
        <Button testID="sched-save" title={saving ? t("app.saving") : t("app.save")} busy={saving} onPress={() => void submit()} />
        <Button kind="secondary" title={t("app.cancel")} disabled={saving} onPress={() => void onDone(false)} />
      </Row>
    </Card>
  );
}

export default function SchedulesScreen() {
  return (
    <PhoneGate>
      <SchedulesList />
    </PhoneGate>
  );
}
