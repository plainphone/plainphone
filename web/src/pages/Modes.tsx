// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useId, useState } from "react";
import { Link } from "react-router";
import { Field, LoadGate, PageTitle, Switch, errorMessage, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey, T } from "../i18n/translate";
import {
  type App,
  ApiError,
  api,
  CONTACT_GROUPS,
  type ContactGroup,
  createMode,
  deleteMode,
  getModes,
  MODE_PRESETS,
  type Mode,
  type ModeInput,
  type ModePreset,
  type ModeSlot,
  type ModeSlotInput,
  type ModesState,
  putModeSchedule,
  setModesEnabled,
  updateMode,
} from "../lib/api";
import { crossesMidnight, formatClock, formatList, hhmmToMinutes, minutesToHHMM, weekdayName } from "../lib/format";
import { usePhone } from "./Phone";

export function modeName(m: Pick<Mode, "name" | "preset">, t: T): string {
  return m.name ?? t(`modes.preset.${m.preset}` as MessageKey);
}

/** True when two slots share a minute of the week (same rule as the server). */
export function slotsOverlap(slots: Pick<ModeSlotInput, "days" | "startMinute" | "endMinute">[]): boolean {
  const week = new Uint8Array(7 * 1440);
  for (const s of slots) {
    for (const day of s.days) {
      const from = (day - 1) * 1440 + s.startMinute;
      const length = (s.endMinute - s.startMinute + 1440) % 1440;
      for (let i = 0; i < length; i++) {
        const at = (from + i) % (7 * 1440);
        if (week[at]) return true;
        week[at] = 1;
      }
    }
  }
  return false;
}

interface Data {
  state: ModesState;
  apps: App[];
}

export function ModesPage() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [switching, setSwitching] = useState(false);

  async function toggle(enabled: boolean) {
    setSwitching(true);
    try {
      setPhone(await setModesEnabled(phone.id, enabled));
      if (!enabled) notify({ tone: "info", text: t("modes.offNote") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <PageTitle sub={t("modes.intro")}>{t("modes.title")}</PageTitle>
      <section className="section">
        <Switch
          checked={phone.modesEnabled === true}
          onChange={(next) => void toggle(next)}
          label={t("modes.switch")}
          description={t("modes.switchHelp")}
          busy={switching}
        />
      </section>
      {phone.modesEnabled === true && <Loaded />}
    </>
  );
}

/** Only mounted while modes are on, so nothing is fetched while they are off. */
function Loaded() {
  const { phone } = usePhone();
  const res = useLoad(async (): Promise<Data> => {
    const [state, a] = await Promise.all([getModes(phone.id), api.get<{ apps: App[] }>(`/phones/${phone.id}/apps`)]);
    return { state, apps: a.apps };
  }, [phone.id]);
  return <LoadGate res={res}>{({ state, apps }) => <Enabled state={state} apps={apps} reload={() => res.reload()} />}</LoadGate>;
}

function Enabled({ state, apps, reload }: { state: ModesState; apps: App[]; reload: () => Promise<unknown> | void }) {
  const { t, locale } = useI18n();
  const { phone, notify } = usePhone();
  const [editing, setEditing] = useState<Mode | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const defaultMode = state.modes.find((m) => m.isDefault);
  const current = state.current ? state.modes.find((m) => m.id === state.current!.modeId) : undefined;

  async function remove(m: Mode) {
    try {
      await deleteMode(phone.id, m.id);
      notify({ tone: "success", text: t("modes.saved") });
      setConfirming(null);
      await reload();
    } catch {
      notify({ tone: "error", text: t("modes.saveFailed") });
    }
  }

  function summary(m: Mode): string {
    const apps_ = m.allApps
      ? t("modes.summary.allApps")
      : m.allowedPackages.length === 0
        ? t("modes.summary.noApps")
        : m.allowedPackages.length === 1
          ? t("modes.summary.app")
          : t("modes.summary.apps", { n: m.allowedPackages.length });
    const groups =
      m.contactGroups.length === 0
        ? t("modes.summary.onlyParents")
        : t("modes.summary.groups", {
            groups: formatList(CONTACT_GROUPS.filter((g) => m.contactGroups.includes(g)).map((g) => t(`group.${g}` as MessageKey)), locale),
          });
    return `${apps_}. ${groups}`;
  }

  return (
    <>
      {current && (
        <p className="row-title" role="status">
          {state.current?.until
            ? t("modes.nowUntil", { mode: modeName(current, t), time: formatClock(hhmmToMinutes(state.current.until) ?? 0, locale) })
            : t("modes.now", { mode: modeName(current, t) })}
        </p>
      )}
      {!state.parentsMarked && (
        <aside className="notice notice-warn">
          <p>
            {t("modes.noParents")} <Link to={`/phones/${phone.id}/contacts`}>{t("modes.goToContacts")}</Link>
          </p>
        </aside>
      )}
      <section className="section" aria-labelledby="modes-list-h">
        <h2 id="modes-list-h">{t("modes.list")}</h2>
        <ul className="list sched-list">
          {state.modes.map((m) =>
            editing !== "new" && editing?.id === m.id ? (
              <li key={m.id}>
                <ModeEditor
                  initial={m}
                  apps={apps}
                  onDone={async (saved) => {
                    setEditing(null);
                    if (saved) await reload();
                  }}
                />
              </li>
            ) : (
              <li key={m.id} className="sched">
                <div className="sched-main">
                  <p className="row-title">
                    {modeName(m, t)} {m.quiet && <span className="tag">{t("modes.summary.quiet")}</span>}
                  </p>
                  {m.isDefault && (
                    <p className="row-meta">
                      {t("modes.default")}. {t("modes.defaultHelp")}
                    </p>
                  )}
                  {!m.isDefault && <p className="row-meta">{summary(m)}</p>}
                </div>
                {confirming === m.id ? (
                  <div className="sched-actions" role="group" aria-label={t("modes.deleteConfirm", { mode: modeName(m, t) })}>
                    <span className="confirm-text">{t("modes.deleteConfirm", { mode: modeName(m, t) })}</span>
                    <button type="button" className="btn btn-danger btn-small" onClick={() => void remove(m)}>
                      {t("modes.delete")}
                    </button>
                    <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirming(null)}>
                      {t("modes.cancel")}
                    </button>
                  </div>
                ) : (
                  <div className="sched-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setEditing(m)}
                      disabled={editing !== null}
                      aria-label={`${t("modes.edit")}: ${modeName(m, t)}`}
                    >
                      {t("modes.edit")}
                    </button>
                    {!m.isDefault && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => setConfirming(m.id)}
                        disabled={editing !== null}
                        aria-label={`${t("modes.delete")}: ${modeName(m, t)}`}
                      >
                        {t("modes.delete")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
        {editing === "new" ? (
          <ModeEditor
            apps={apps}
            onDone={async (saved) => {
              setEditing(null);
              if (saved) await reload();
            }}
          />
        ) : (
          <p>
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")} disabled={editing !== null}>
              {t("modes.add")}
            </button>
          </p>
        )}
      </section>
      <Plan
        // Only the saved slots reset the plan: adding or renaming a mode keeps unsaved slots.
        // Deleting a mode takes its slots on the server, so that still resets it.
        key={JSON.stringify(state.slots)}
        modes={state.modes}
        defaultName={defaultMode ? modeName(defaultMode, t) : ""}
        slots={state.slots}
        reload={reload}
      />
      <p className="help">{t("modes.olderPhone")}</p>
    </>
  );
}

function toggleIn<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

function ModeEditor({ initial, apps, onDone }: { initial?: Mode; apps: App[]; onDone: (saved: boolean) => void | Promise<void> }) {
  const { t, locale } = useI18n();
  const { phone, notify } = usePhone();
  const id = useId();
  const isDefault = initial?.isDefault === true;
  const [name, setName] = useState(initial?.name ?? "");
  const [preset, setPreset] = useState<ModePreset>(initial?.preset ?? "custom");
  const [allApps, setAllApps] = useState(initial?.allApps ?? true);
  const [allowed, setAllowed] = useState<Set<string>>(new Set(initial?.allowedPackages ?? []));
  const [groups, setGroups] = useState<Set<ContactGroup>>(new Set(initial?.contactGroups ?? ["family"]));
  const [quiet, setQuiet] = useState(initial?.quiet ?? false);
  const [saving, setSaving] = useState(false);
  const reported = new Set(apps.map((a) => a.packageName));
  const choosable = [
    ...apps.filter((a) => !a.core),
    ...(initial?.allowedPackages ?? []).filter((p) => !reported.has(p)).map((p) => ({ packageName: p, label: p }) as App),
  ].sort((a, b) => a.label.localeCompare(b.label, locale));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const trimmed = name.trim();
    setSaving(true);
    try {
      if (isDefault) {
        await updateMode(phone.id, initial!.id, { name: trimmed === "" ? null : trimmed });
      } else {
        const body: ModeInput = {
          preset,
          name: trimmed === "" ? null : trimmed,
          allApps,
          allowedPackages: allApps ? [] : [...allowed].filter((p) => choosable.some((a) => a.packageName === p)),
          contactGroups: CONTACT_GROUPS.filter((g) => groups.has(g)),
          quiet,
        };
        if (initial) await updateMode(phone.id, initial.id, body);
        else await createMode(phone.id, body);
      }
      notify({ tone: "success", text: t("modes.saved") });
      await onDone(true);
    } catch {
      notify({ tone: "error", text: t("modes.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack form-card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="h3">
        {initial ? `${t("modes.edit")}: ${modeName(initial, t)}` : t("modes.new")}
      </h2>
      <Field label={t("modes.name")} optional>
        {(p) => <input {...p} name="name" maxLength={30} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      {isDefault && <p className="help">{t("modes.defaultHelp")}</p>}
      {!isDefault && !initial && (
        <Field label={t("modes.kind")}>
          {(p) => (
            <select {...p} value={preset} onChange={(e) => setPreset(e.target.value as ModePreset)}>
              {MODE_PRESETS.map((k) => (
                <option key={k} value={k}>
                  {t(`modes.preset.${k}` as MessageKey)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {!isDefault && (
        <>
          <fieldset className="segmented">
            <legend>{t("modes.apps")}</legend>
            <label className="seg">
              <input type="radio" name={`${id}-apps`} checked={allApps} onChange={() => setAllApps(true)} />
              <span>{t("modes.allApps")}</span>
            </label>
            <label className="seg">
              <input type="radio" name={`${id}-apps`} checked={!allApps} onChange={() => setAllApps(false)} />
              <span>{t("modes.someApps")}</span>
            </label>
            <p className="help">{t("modes.appsHelp")}</p>
          </fieldset>
          {!allApps && choosable.length > 0 && (
            <fieldset className="checks">
              <legend className="sr-only">{t("modes.apps")}</legend>
              <div className="check-grid">
                {choosable.map((a) => (
                  <label key={a.packageName} className="check">
                    <input type="checkbox" checked={allowed.has(a.packageName)} onChange={() => setAllowed(toggleIn(allowed, a.packageName))} />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="checks">
            <legend>{t("modes.contacts")}</legend>
            <p className="help">{t("modes.contactsHelp")}</p>
            <div className="check-grid">
              {CONTACT_GROUPS.map((g) => (
                <label key={g} className="check">
                  <input type="checkbox" checked={groups.has(g)} onChange={() => setGroups(toggleIn(groups, g))} />
                  <span>{t(`group.${g}` as MessageKey)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Switch checked={quiet} onChange={setQuiet} label={t("modes.quiet")} description={t("modes.quietHelp")} />
        </>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {t("modes.save")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void onDone(false)} disabled={saving}>
          {t("modes.cancel")}
        </button>
      </div>
    </form>
  );
}

interface Draft extends ModeSlotInput {
  key: string;
}

/** The slots of one day, with a slot that crosses midnight cut at midnight and carried to the next day. */
export function dayBlocks(slots: ModeSlotInput[], day: number): { modeId: string; start: number; end: number }[] {
  const out: { modeId: string; start: number; end: number }[] = [];
  const prev = day === 1 ? 7 : day - 1;
  for (const s of slots) {
    const over = crossesMidnight(s.startMinute, s.endMinute);
    if (s.days.includes(day)) out.push({ modeId: s.modeId, start: s.startMinute, end: over ? 1440 : s.endMinute });
    if (over && s.days.includes(prev)) out.push({ modeId: s.modeId, start: 0, end: s.endMinute });
  }
  return out.sort((a, b) => a.start - b.start);
}

function Plan({ modes, defaultName, slots, reload }: { modes: Mode[]; defaultName: string; slots: ModeSlot[]; reload: () => Promise<unknown> | void }) {
  const { t, locale } = useI18n();
  const { phone, notify } = usePhone();
  const [allDrafts, setDrafts] = useState<Draft[]>(() => slots.map((s) => ({ key: s.id, modeId: s.modeId, days: s.days, startMinute: s.startMinute, endMinute: s.endMinute })));
  // An unsaved slot of a mode that was deleted meanwhile goes with the mode.
  const drafts = allDrafts.filter((d) => modes.some((m) => m.id === d.modeId));
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<Draft | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [overlap, setOverlap] = useState(false);
  const choosable = modes.filter((m) => !m.isDefault);
  const nameOf = (modeId: string) => {
    const m = modes.find((x) => x.id === modeId);
    return m ? modeName(m, t) : "";
  };
  const clock = (min: number) => formatClock(min % 1440, locale);

  function change(next: Draft[]) {
    setDrafts(next);
    setDirty(true);
    setOverlap(slotsOverlap(next));
  }

  async function save() {
    if (slotsOverlap(drafts)) {
      setOverlap(true);
      return;
    }
    setSaving(true);
    try {
      await putModeSchedule(phone.id, drafts.map(({ modeId, days, startMinute, endMinute }) => ({ modeId, days, startMinute, endMinute })));
      notify({ tone: "success", text: t("modes.saved") });
      setDirty(false);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.message === "overlap") setOverlap(true);
      else notify({ tone: "error", text: t("modes.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...drafts];

  return (
    <section className="section" aria-labelledby="modes-plan-h">
      <h2 id="modes-plan-h">{t("modes.schedule")}</h2>
      <p className="help">{t("modes.scheduleHelp", { mode: defaultName })}</p>
      <ol className="list week-plan">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const blocks = dayBlocks(drafts, d);
          return (
            <li key={d} className="item">
              <span className="row-title">
                <span aria-hidden="true">{weekdayName(d, locale, "short").replace(/\.$/, "")}</span>
                <span className="sr-only">{weekdayName(d, locale, "long")}</span>
              </span>
              <span className="week-blocks">
                {blocks.length === 0 ? (
                  <span className="muted">{defaultName}</span>
                ) : (
                  blocks.map((b, i) => (
                    <span key={i} className="tag">
                      {nameOf(b.modeId)} {clock(b.start)}-{b.end === 1440 ? "24:00" : clock(b.end)}
                    </span>
                  ))
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {overlap && (
        <p role="alert" className="field-error">
          {t("modes.overlap")}
        </p>
      )}
      {sorted.length === 0 && editing === null && <p className="empty-inline">{t("modes.scheduleEmpty")}</p>}
      <ul className="list sched-list">
        {sorted.map((s) =>
          editing !== "new" && editing?.key === s.key ? (
            <li key={s.key}>
              <SlotEditor
                initial={s}
                modes={choosable}
                onSave={(v) => {
                  change(drafts.map((x) => (x.key === s.key ? { ...v, key: s.key } : x)));
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={s.key} className="sched">
              <div className="sched-main">
                <p className="row-title">{nameOf(s.modeId)}</p>
                <p className="sched-when">
                  {formatList([...s.days].sort((a, b) => a - b).map((d) => weekdayName(d, locale, "short")), locale)}, {clock(s.startMinute)}-{clock(s.endMinute)}
                </p>
              </div>
              <div className="sched-actions">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(s)} disabled={editing !== null}>
                  {t("modes.editSlot")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => change(drafts.filter((x) => x.key !== s.key))}
                  disabled={editing !== null}
                  aria-label={`${t("modes.removeSlot")}: ${nameOf(s.modeId)}`}
                >
                  {t("modes.removeSlot")}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      {editing === "new" && (
        <SlotEditor
          modes={choosable}
          onSave={(v) => {
            change([...drafts, { ...v, key: `new-${Date.now()}-${drafts.length}` }]);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      <div className="actions">
        {editing === null && (
          <button type="button" className="btn btn-secondary" onClick={() => setEditing("new")} disabled={choosable.length === 0}>
            {t("modes.addSlot")}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving || editing !== null}>
          {t("modes.save")}
        </button>
      </div>
    </section>
  );
}

function SlotEditor({
  initial,
  modes,
  onSave,
  onCancel,
}: {
  initial?: ModeSlotInput;
  modes: Mode[];
  onSave: (slot: ModeSlotInput) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const [modeId, setModeId] = useState(initial?.modeId ?? modes[0]?.id ?? "");
  const [days, setDays] = useState<Set<number>>(new Set(initial?.days ?? [1, 2, 3, 4, 5]));
  const [start, setStart] = useState(minutesToHHMM(initial?.startMinute ?? 8 * 60));
  const [end, setEnd] = useState(minutesToHHMM(initial?.endMinute ?? 14 * 60));
  const [errors, setErrors] = useState<{ days?: string; start?: string; end?: string }>({});
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);

  function submit(ev: FormEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    const next: typeof errors = {};
    if (days.size === 0) next.days = t("sched.noDays");
    if (s === null) next.start = t("sched.badTime");
    if (e === null) next.end = t("sched.badTime");
    if (s !== null && e !== null && s === e) next.end = t("sched.sameTime");
    setErrors(next);
    if (next.days || next.start || next.end || !modeId) return;
    onSave({ modeId, days: [...days].sort((a, b) => a - b), startMinute: s!, endMinute: e! });
  }

  return (
    <form onSubmit={submit} noValidate className="stack form-card" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="h3">
        {t(initial ? "modes.editSlot" : "modes.addSlot")}
      </h3>
      <Field label={t("modes.slotMode")}>
        {(p) => (
          <select {...p} value={modeId} onChange={(ev) => setModeId(ev.target.value)}>
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {modeName(m, t)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <fieldset className={`days${errors.days ? " field-invalid" : ""}`}>
        <legend>{t("sched.days")}</legend>
        <div className="day-grid">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className="day">
              <input type="checkbox" checked={days.has(d)} onChange={() => setDays(toggleIn(days, d))} />
              <span aria-hidden="true">{weekdayName(d, locale, "short").replace(/\.$/, "")}</span>
              <span className="sr-only">{weekdayName(d, locale, "long")}</span>
            </label>
          ))}
        </div>
        {errors.days && <p className="field-error">{errors.days}</p>}
      </fieldset>
      <div className="time-row">
        <Field label={t("sched.start")} error={errors.start}>
          {(p) => <input {...p} type="time" step={300} value={start} onChange={(ev) => setStart(ev.target.value)} />}
        </Field>
        <Field label={t("sched.end")} error={errors.end}>
          {(p) => <input {...p} type="time" step={300} value={end} onChange={(ev) => setEnd(ev.target.value)} />}
        </Field>
      </div>
      {s !== null && e !== null && s !== e && crossesMidnight(s, e) && <p className="help">{t("sched.nextDay")}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary">
          {t("modes.save")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {t("modes.cancel")}
        </button>
      </div>
    </form>
  );
}
