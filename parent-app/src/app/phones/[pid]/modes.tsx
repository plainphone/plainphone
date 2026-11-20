// SPDX-License-Identifier: Apache-2.0
//
// Modes and the weekly plan (docs/modes.md). Child phones only. The same screen as the
// dashboard's Modes page in web/.
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { App, ContactGroup, Mode, ModeInput, ModeSlot, Phone } from "../../../api/models";
import { CheckRow, Chip } from "../../../components/parts";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, Choice, errorMessage, Field, LoadGate, Notice, PageTitle, Row, Screen, Stack as VStack, Switch, Text, useLoad } from "../../../components/ui";
import { type Key, type TFn, useI18n } from "../../../i18n/I18n";
import { planOverlaps } from "../../../lib/modePlan";
import { space, useColors } from "../../../lib/theme";
import { formatList, hhmmToMinutes, minutesToHHMM, weekdayName } from "../../../shared/lib/format";

const GROUPS: ContactGroup[] = ["family", "friends", "others"];
const PRESETS: Mode["preset"][] = ["school", "homework", "free", "night", "custom"];
const DAYS = [1, 2, 3, 4, 5, 6, 7];
let newSlot = 0;

interface Data {
  parentsMarked: boolean;
  modes: Mode[];
  slots: ModeSlot[];
  current: { modeId: string; until: string | null } | null;
  apps: App[];
}

/** One slot while it is being edited; the plan is only sent when the parent saves it. */
interface Draft {
  key: string;
  modeId: string;
  days: number[];
  startMinute: number;
  endMinute: number;
}

const modeName = (m: Mode, t: TFn) => m.name ?? t(`modes.preset.${m.preset}` as Key);
const toggled = <T,>(set: T[], v: T): T[] => (set.includes(v) ? set.filter((x) => x !== v) : [...set, v]);
const planOf = (slots: ModeSlot[]): Draft[] => slots.map((s) => ({ key: s.id, modeId: s.modeId, days: s.days, startMinute: s.startMinute, endMinute: s.endMinute }));

function summary(m: Mode, t: TFn, locale: Parameters<typeof formatList>[1]): string {
  const parts: string[] = [];
  if (m.isDefault) {
    parts.push(t("modes.summary.allApps"));
  } else {
    const n = m.allowedPackages.length;
    parts.push(m.allApps ? t("modes.summary.allApps") : n === 0 ? t("modes.summary.noApps") : n === 1 ? t("modes.summary.app") : t("modes.summary.apps", { n }));
    parts.push(
      m.contactGroups.length === 0
        ? t("modes.summary.onlyParents")
        : t("modes.summary.groups", { groups: formatList(GROUPS.filter((g) => m.contactGroups.includes(g)).map((g) => t(`group.${g}` as Key)), locale) }),
    );
    if (m.quiet) parts.push(t("modes.summary.quiet"));
  }
  return parts.join(", ");
}

function ModesPage() {
  const { t, locale } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const router = useRouter();
  const enabled = phone.modesEnabled === true;
  const [switching, setSwitching] = useState(false);
  const res = useLoad(async (): Promise<Data | null> => {
    if (!enabled) return null;
    const [m, a] = await Promise.all([
      unwrap<Omit<Data, "apps">>(client.GET("/phones/{pid}/modes", { params: { path: { pid: phone.id } } })),
      unwrap<{ apps: App[] }>(client.GET("/phones/{pid}/apps", { params: { path: { pid: phone.id } } })),
    ]);
    return { ...m, apps: a.apps };
  }, [phone.id, enabled]);

  async function switchModes(value: boolean) {
    setSwitching(true);
    try {
      setPhone(await unwrap<Phone>(client.PATCH("/phones/{pid}", { params: { path: { pid: phone.id } }, body: { modesEnabled: value } })));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Screen testID="phone-modes" onRefresh={() => void res.reload()} refreshing={res.loading && res.data != null}>
      <PageTitle sub={t("modes.intro")}>{t("modes.title")}</PageTitle>
      <Card>
        <Switch
          testID="modes-switch"
          label={t("modes.switch")}
          help={t("modes.switchHelp")}
          value={enabled}
          disabled={switching}
          onValueChange={(v) => void switchModes(v)}
        />
      </Card>
      {enabled ? (
        <LoadGate res={res}>
          {(data) =>
            data ? (
              <ModesBody data={data} reload={res.reload} toContacts={() => router.push({ pathname: "/phones/[pid]/contacts", params: { pid: phone.id } })} locale={locale} />
            ) : null
          }
        </LoadGate>
      ) : null}
    </Screen>
  );
}

function ModesBody({ data, reload, toContacts, locale }: { data: Data; reload: () => Promise<unknown>; toContacts: () => void; locale: Parameters<typeof formatList>[1] }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Mode | "new" | null>(null);
  const def = data.modes.find((m) => m.isDefault);
  const current = data.current ? data.modes.find((m) => m.id === data.current!.modeId) : undefined;
  const modes = [...data.modes].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  return (
    <>
      {current ? (
        <Card testID="modes-now">
          <Text variant="heading" accessibilityLiveRegion="polite">
            {data.current?.until
              ? t("modes.nowUntil", { mode: modeName(current, t), time: data.current.until })
              : t("modes.now", { mode: modeName(current, t) })}
          </Text>
        </Card>
      ) : null}
      {!data.parentsMarked ? (
        <Notice tone="warn" text={t("modes.noParents")}>
          <Button testID="modes-to-contacts" kind="secondary" title={t("modes.goToContacts")} onPress={toContacts} />
        </Notice>
      ) : null}

      <VStack gap={space.sm}>
        <Text variant="heading">{t("modes.list")}</Text>
        {modes.map((m) =>
          editing !== "new" && editing?.id === m.id ? (
            <ModeEditor
              key={m.id}
              initial={m}
              apps={data.apps}
              onDone={async (saved) => {
                setEditing(null);
                if (saved) await reload();
              }}
            />
          ) : (
            <Card key={m.id} testID={`mode-${m.id}`} style={{ gap: space.xs }}>
              <Text variant="label">{modeName(m, t)}</Text>
              {m.isDefault ? <Text variant="small">{t("modes.default")}</Text> : <Text variant="small">{summary(m, t, locale)}</Text>}
              <Row>
                <Button
                  testID={`mode-edit-${m.id}`}
                  kind="secondary"
                  title={t("app.edit")}
                  accessibilityLabel={`${t("app.edit")}: ${modeName(m, t)}`}
                  disabled={editing !== null}
                  onPress={() => setEditing(m)}
                />
              </Row>
            </Card>
          ),
        )}
        {editing === "new" ? (
          <ModeEditor
            apps={data.apps}
            onDone={async (saved) => {
              setEditing(null);
              if (saved) await reload();
            }}
          />
        ) : (
          <Button testID="mode-add" title={t("modes.add")} disabled={editing !== null} onPress={() => setEditing("new")} />
        )}
      </VStack>

      <Plan data={data} defaultName={def ? modeName(def, t) : t("modes.preset.free")} reload={reload} />
      <Text variant="small">{t("modes.olderPhone")}</Text>
    </>
  );
}

function ModeEditor({ initial, apps, onDone }: { initial?: Mode; apps: App[]; onDone: (saved: boolean) => void | Promise<void> }) {
  const { t, locale } = useI18n();
  const { phone, notify } = usePhone();
  const isDefault = initial?.isDefault === true;
  const [preset, setPreset] = useState<Mode["preset"]>(initial?.preset ?? "custom");
  const [name, setName] = useState(initial?.name ?? "");
  const [allApps, setAllApps] = useState(initial?.allApps ?? true);
  const [allowed, setAllowed] = useState<string[]>(initial?.allowedPackages ?? []);
  const [groups, setGroups] = useState<ContactGroup[]>(initial?.contactGroups ?? ["family"]);
  const [quiet, setQuiet] = useState(initial?.quiet ?? false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const choosable = apps.filter((a) => !a.core).sort((a, b) => a.label.localeCompare(b.label, locale));
  const path = { params: { path: { pid: phone.id, mid: initial?.id ?? "" } } };

  async function submit() {
    setSaving(true);
    setFailed(false);
    const trimmed = name.trim();
    try {
      if (initial && isDefault) {
        // The default mode takes only its name.
        await unwrap(client.PUT("/phones/{pid}/modes/{mid}", { ...path, body: { name: trimmed || null } as unknown as ModeInput }));
      } else {
        const body: ModeInput = {
          preset,
          name: trimmed || null,
          allApps,
          allowedPackages: allApps ? [] : allowed.filter((p) => choosable.some((a) => a.packageName === p)),
          contactGroups: GROUPS.filter((g) => groups.includes(g)),
          quiet,
        };
        if (initial) await unwrap(client.PUT("/phones/{pid}/modes/{mid}", { ...path, body }));
        else await unwrap(client.POST("/phones/{pid}/modes", { params: { path: { pid: phone.id } }, body }));
      }
      notify({ tone: "success", text: t("modes.saved") });
      await onDone(true);
    } catch {
      setFailed(true);
      notify({ tone: "error", text: t("modes.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!initial) return;
    setSaving(true);
    try {
      await unwrap(client.DELETE("/phones/{pid}/modes/{mid}", path));
      notify({ tone: "success", text: t("modes.saved") });
      await onDone(true);
    } catch {
      setFailed(true);
      notify({ tone: "error", text: t("modes.saveFailed") });
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <Card testID="mode-editor">
      <Text variant="heading">{initial ? t("modes.edit") : t("modes.new")}</Text>
      <Field testID="mode-name" label={t("modes.name")} value={name} onChangeText={setName} maxLength={40} autoComplete="off" />
      {isDefault ? (
        <Text variant="small">{t("modes.defaultHelp")}</Text>
      ) : (
        <>
          {initial ? null : (
            <Choice<Mode["preset"]>
              testID="mode-kind"
              label={t("modes.kind")}
              value={preset}
              onChange={setPreset}
              options={PRESETS.map((p) => ({ value: p, label: t(`modes.preset.${p}` as Key) }))}
            />
          )}
          <Choice<"all" | "some">
            testID="mode-apps"
            label={t("modes.apps")}
            hint={t("modes.appsHelp")}
            value={allApps ? "all" : "some"}
            onChange={(v) => setAllApps(v === "all")}
            options={[
              { value: "all", label: t("modes.allApps"), testID: "mode-apps-all" },
              { value: "some", label: t("modes.someApps"), testID: "mode-apps-some" },
            ]}
          />
          {allApps ? null : choosable.length === 0 ? (
            <Text variant="muted">{t("sched.noApps")}</Text>
          ) : (
            <View style={{ gap: space.xs }}>
              {choosable.map((a) => (
                <CheckRow
                  key={a.packageName}
                  testID={`mode-app-${a.packageName}`}
                  label={a.label}
                  checked={allowed.includes(a.packageName)}
                  onToggle={() => setAllowed(toggled(allowed, a.packageName))}
                />
              ))}
            </View>
          )}
          <View style={{ gap: space.xs }}>
            <Text variant="label">{t("modes.contacts")}</Text>
            <Text variant="small">{t("modes.contactsHelp")}</Text>
            {GROUPS.map((g) => (
              <CheckRow key={g} testID={`mode-group-${g}`} label={t(`group.${g}` as Key)} checked={groups.includes(g)} onToggle={() => setGroups(toggled(groups, g))} />
            ))}
          </View>
          <Switch testID="mode-quiet" label={t("modes.quiet")} help={t("modes.quietHelp")} value={quiet} onValueChange={setQuiet} />
        </>
      )}
      {failed ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {t("modes.saveFailed")}
        </Text>
      ) : null}
      {confirming && initial ? (
        <VStack>
          <Text accessibilityLiveRegion="polite">{t("modes.deleteConfirm", { mode: modeName(initial, t) })}</Text>
          <Row>
            <Button testID="mode-delete-yes" kind="danger" title={t("app.confirmDelete")} busy={saving} onPress={() => void remove()} />
            <Button kind="secondary" title={t("modes.cancel")} disabled={saving} onPress={() => setConfirming(false)} />
          </Row>
        </VStack>
      ) : (
        <Row>
          <Button testID="mode-save" title={saving ? t("app.saving") : t("modes.save")} busy={saving} onPress={() => void submit()} />
          <Button kind="secondary" title={t("modes.cancel")} disabled={saving} onPress={() => void onDone(false)} />
          {initial && !isDefault ? <Button testID="mode-delete" kind="secondary" title={t("modes.delete")} disabled={saving} onPress={() => setConfirming(true)} /> : null}
        </Row>
      )}
    </Card>
  );
}

function Plan({ data, defaultName, reload }: { data: Data; defaultName: string; reload: () => Promise<unknown> }) {
  const { t, locale } = useI18n();
  const { phone, notify } = usePhone();
  const c = useColors();
  const choices = data.modes.filter((m) => !m.isDefault);
  const [slots, setSlots] = useState<Draft[]>(() => planOf(data.slots));
  const [saved, setSaved] = useState(() => JSON.stringify(planOf(data.slots)));
  const [editing, setEditing] = useState<Draft | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [overlap, setOverlap] = useState(false);
  const [failed, setFailed] = useState(false);
  const dirty = JSON.stringify(slots) !== saved;
  const nameOf = (id: string) => {
    const m = data.modes.find((x) => x.id === id);
    return m ? modeName(m, t) : "";
  };
  const time = (s: Draft) => `${minutesToHHMM(s.startMinute)}-${minutesToHHMM(s.endMinute)}`;

  function change(next: Draft[]) {
    setSlots(next);
    setOverlap(planOverlaps(next));
    setFailed(false);
  }

  async function save() {
    if (planOverlaps(slots)) {
      setOverlap(true);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await unwrap(
        client.PUT("/phones/{pid}/mode-schedule", {
          params: { path: { pid: phone.id } },
          body: { slots: slots.map((s) => ({ modeId: s.modeId, days: [...s.days].sort((a, b) => a - b), startMinute: s.startMinute, endMinute: s.endMinute })) },
        }),
      );
      notify({ tone: "success", text: t("modes.saved") });
      setSaved(JSON.stringify(slots));
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.message === "overlap") setOverlap(true);
      else {
        setFailed(true);
        notify({ tone: "error", text: t("modes.saveFailed") });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <VStack gap={space.sm}>
      <Text variant="heading">{t("modes.schedule")}</Text>
      <Text variant="small">{t("modes.scheduleHelp", { mode: defaultName })}</Text>
      {slots.length === 0 ? <Text variant="muted">{t("modes.scheduleEmpty")}</Text> : null}
      <Card testID="mode-week" style={{ gap: space.sm }}>
        {DAYS.map((d) => {
          const today = slots.filter((s) => s.days.includes(d)).sort((a, b) => a.startMinute - b.startMinute);
          return (
            <View key={d} style={{ gap: space.xs }}>
              <Text variant="label">{weekdayName(d, locale, "long")}</Text>
              <Row gap={space.xs}>
                {today.length === 0 ? <Text variant="small">{defaultName}</Text> : null}
                {today.map((s) => (
                  <View key={s.key} accessible accessibilityLabel={`${time(s)} ${nameOf(s.modeId)}`} style={{ paddingHorizontal: space.sm, paddingVertical: space.xs, borderWidth: 1, borderRadius: 16, borderColor: c.borderStrong }}>
                    <Text variant="small">{`${time(s)} ${nameOf(s.modeId)}`}</Text>
                  </View>
                ))}
              </Row>
            </View>
          );
        })}
      </Card>

      {slots.map((s) =>
        editing !== "new" && editing?.key === s.key ? (
          <SlotEditor
            key={s.key}
            initial={s}
            choices={choices}
            onDone={(next) => {
              setEditing(null);
              if (next) change(slots.map((x) => (x.key === s.key ? next : x)));
            }}
          />
        ) : (
          <Card key={s.key} testID={`slot-${s.key}`} style={{ gap: space.xs }}>
            <Text variant="label">{nameOf(s.modeId)}</Text>
            <Text>
              {DAYS.filter((d) => s.days.includes(d))
                .map((d) => weekdayName(d, locale, "short").replace(/\.$/, ""))
                .join(", ")}
              {", "}
              {time(s)}
            </Text>
            <Row>
              <Button kind="secondary" title={t("app.edit")} accessibilityLabel={`${t("modes.editSlot")}: ${nameOf(s.modeId)} ${time(s)}`} disabled={editing !== null} onPress={() => setEditing(s)} />
              <Button
                testID={`slot-remove-${s.key}`}
                kind="secondary"
                title={t("modes.removeSlot")}
                accessibilityLabel={`${t("modes.removeSlot")}: ${nameOf(s.modeId)} ${time(s)}`}
                disabled={editing !== null}
                onPress={() => change(slots.filter((x) => x.key !== s.key))}
              />
            </Row>
          </Card>
        ),
      )}
      {editing === "new" ? (
        <SlotEditor
          choices={choices}
          onDone={(next) => {
            setEditing(null);
            if (next) change([...slots, { ...next, key: `new-${++newSlot}` }]);
          }}
        />
      ) : choices.length > 0 ? (
        <Button testID="slot-add" kind="secondary" title={t("modes.addSlot")} disabled={editing !== null} onPress={() => setEditing("new")} />
      ) : null}

      {overlap ? (
        <Text variant="error" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t("modes.overlap")}
        </Text>
      ) : null}
      {failed ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {t("modes.saveFailed")}
        </Text>
      ) : null}
      <Button testID="plan-save" title={saving ? t("app.saving") : t("modes.save")} busy={saving} disabled={!dirty || editing !== null} onPress={() => void save()} />
    </VStack>
  );
}

function SlotEditor({ initial, choices, onDone }: { initial?: Draft; choices: Mode[]; onDone: (next: Draft | null) => void }) {
  const { t, locale } = useI18n();
  const [modeId, setModeId] = useState(initial?.modeId ?? choices[0]?.id ?? "");
  const [days, setDays] = useState<number[]>(initial?.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(minutesToHHMM(initial?.startMinute ?? 8 * 60));
  const [end, setEnd] = useState(minutesToHHMM(initial?.endMinute ?? 14 * 60));
  const [errors, setErrors] = useState<{ days?: string; start?: string; end?: string }>({});

  function submit() {
    const s = hhmmToMinutes(start);
    const e = hhmmToMinutes(end);
    const next: typeof errors = {};
    if (days.length === 0) next.days = t("sched.noDays");
    if (s === null) next.start = t("sched.badTime");
    if (e === null) next.end = t("sched.badTime");
    if (s !== null && e !== null && s === e) next.end = t("sched.sameTime");
    setErrors(next);
    if (next.days || next.start || next.end || s === null || e === null) return;
    onDone({ key: initial?.key ?? "", modeId, days, startMinute: s, endMinute: e });
  }

  return (
    <Card testID="slot-editor">
      <Text variant="heading">{initial ? t("modes.editSlot") : t("modes.addSlot")}</Text>
      <Choice<string>
        testID="slot-mode"
        label={t("modes.slotMode")}
        value={modeId}
        onChange={setModeId}
        options={choices.map((m) => ({ value: m.id, label: modeName(m, t), testID: `slot-mode-${m.id}` }))}
      />
      <View style={{ gap: space.sm }}>
        <Text variant="label">{t("sched.days")}</Text>
        <Row gap={space.xs}>
          {DAYS.map((d) => (
            <Chip
              key={d}
              testID={`slot-day-${d}`}
              label={weekdayName(d, locale, "short").replace(/\.$/, "")}
              accessibilityLabel={weekdayName(d, locale, "long")}
              checked={days.includes(d)}
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
        testID="slot-start"
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
        testID="slot-end"
        label={t("sched.end")}
        error={errors.end}
        value={end}
        onChangeText={setEnd}
        placeholder="14:00"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        autoComplete="off"
        autoCorrect={false}
      />
      <Row>
        <Button testID="slot-done" title={t("app.save")} onPress={submit} />
        <Button kind="secondary" title={t("modes.cancel")} onPress={() => onDone(null)} />
      </Row>
    </Card>
  );
}

export default function ModesScreen() {
  return (
    <PhoneGate>
      <ModesPage />
    </PhoneGate>
  );
}
