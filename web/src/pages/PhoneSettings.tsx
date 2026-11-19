// SPDX-License-Identifier: Apache-2.0
import { useEffect, useId, useMemo, useState } from "react";
import { LoadGate, PageTitle, PickGroup, type PickOption, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "../i18n/translate";
import {
  api,
  ApiError,
  getPhoneSettings,
  type Phone,
  type PhoneSetting,
  putPhoneSetting,
  type SettingKey,
  type SettingMode,
} from "../lib/api";
import {
  formatSettingValue,
  modesOf,
  pickable,
  sameSetting,
  savesAtOnce,
  SETTING_GROUPS,
  SETTING_SPECS,
  type SettingSpec,
  settingName,
  stateFor,
} from "../lib/settings";
import { usePhone } from "./Phone";
import { PhoneLanguagePicker } from "../components/PhoneLanguagePicker";
import type { PhoneLanguage } from "../lib/phone-language";
import { intlLocale } from "../lib/format";

export function PhoneSettingsPage() {
  const { t } = useI18n();
  const { phone, setPhone, run, pending, notify } = usePhone();
  const res = useLoad(() => getPhoneSettings(phone.id), [phone.id]);
  const light = phone.mode === "light";
  const [savingLanguage, setSavingLanguage] = useState(false);
  async function saveLanguage(language: PhoneLanguage) {
    setSavingLanguage(true);
    try {
      const updated = await api.patch<Phone>(`/phones/${phone.id}`, { language });
      setPhone(updated);
      notify({ tone: "success", text: t(updated.setupQrAvailable ? "add.setupChanged" : "app.saved") });
    } catch {
      notify({ tone: "error", text: t("error.generic") });
    } finally {
      setSavingLanguage(false);
    }
  }

  // A loosening change on a Self phone waits for the key; the row says so.
  const waiting = useMemo(
    () => new Set<string>(pending.flatMap((c) => (c.op.type === "setting.set" ? [c.op.key] : []))),
    [pending],
  );

  /** Saves one setting. Returns false when nothing was sent or the server said no. */
  async function save(key: SettingKey, setting: PhoneSetting): Promise<boolean> {
    try {
      const r = await run(() => putPhoneSetting(phone.id, key, setting));
      if (r?.status === "applied") res.setData((d) => d && { ...d, [key]: setting });
      return r !== null;
    } catch (err) {
      if (err instanceof ApiError) notify({ tone: "error", text: t("error.generic") });
      return false;
    }
  }

  return (
    <>
      <PageTitle sub={t("phoneSettings.intro")}>{t("phoneSettings.title")}</PageTitle>
      <section className="section">
        <PhoneLanguagePicker value={phone.language ?? null} onChange={(language) => void saveLanguage(language)} disabled={savingLanguage} />
      </section>
      {light && (
        <p className="notice notice-info" role="status">
          {t("phoneSettings.lightNote")}
        </p>
      )}
      {light && <SetupUndoSetting key={phone.id} />}
      {phone.profile === "self" && <p className="help">{t("phoneSettings.selfNote")}</p>}
      <details className="details details-lead">
        <summary>{t("phoneSettings.explainTitle")}</summary>
        <ul className="explain">
          <li>{t("phoneSettings.explainFree", { free: t(phone.profile === "self" ? "phoneSettings.mode.freeSelf" : "phoneSettings.mode.freeChild") })}</li>
          <li>{t("phoneSettings.explainPreset")}</li>
          <li>{t("phoneSettings.explainLocked")}</li>
        </ul>
      </details>
      <LoadGate res={res}>
        {(settings) =>
          SETTING_GROUPS.map((group) => (
            <section key={group} className="section" aria-labelledby={`group-${group}`}>
              <h2 id={`group-${group}`}>{t(`phoneSettings.group.${group}` as MessageKey)}</h2>
              <ul className="list">
                {SETTING_SPECS.filter((s) => s.group === group).map((spec) => (
                  <SettingRow
                    key={spec.key}
                    spec={spec}
                    saved={settings[spec.key]}
                    waiting={waiting.has(spec.key)}
                    disabled={light}
                    onSave={save}
                  />
                ))}
              </ul>
            </section>
          ))
        }
      </LoadGate>
    </>
  );
}

function SettingRow({
  spec,
  saved,
  waiting,
  disabled,
  onSave,
}: {
  spec: SettingSpec;
  saved: PhoneSetting;
  waiting: boolean;
  disabled: boolean;
  onSave: (key: SettingKey, setting: PhoneSetting) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { phone } = usePhone();
  const id = useId();
  // What the parent has picked but not saved yet. Only choices that need a value wait for Save.
  const [draft, setDraft] = useState<PhoneSetting | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft ?? saved;
  const choices = pickable(spec, shown.mode);
  const dirty = draft !== null && !sameSetting(draft, saved);
  const freeLabel = t(phone.profile === "self" ? "phoneSettings.mode.freeSelf" : "phoneSettings.mode.freeChild");

  const modeOptions: PickOption<SettingMode>[] = modesOf(spec).map((mode) => ({
    value: mode,
    quiet: mode === "free",
    label: mode === "free" ? freeLabel : t(mode === "preset" ? "phoneSettings.mode.preset" : "phoneSettings.mode.locked"),
  }));

  async function commit(next: PhoneSetting) {
    if (busy) return;
    setBusy(true);
    const ok = await onSave(spec.key, next);
    setBusy(false);
    if (ok) setDraft(null);
  }

  function pickMode(mode: SettingMode) {
    if (busy || mode === shown.mode) return;
    const next = stateFor(spec, mode, mode === saved.mode ? saved : shown);
    if (savesAtOnce(spec, mode)) void commit(next);
    else setDraft(sameSetting(next, saved) ? null : next);
  }

  function pickValue(raw: string) {
    const value = choices?.find((c) => String(c) === raw);
    if (value === undefined) return;
    const next = { mode: shown.mode, value };
    setDraft(sameSetting(next, saved) ? null : next);
  }

  return (
    <li className="setting" aria-busy={busy || undefined}>
      <div className="setting-head">
        <p className="row-title" id={`${id}-n`}>
          {settingName(spec.key, t)}
        </p>
        {waiting && <span className="tag tag-waiting">{t("pending.waitingTag")}</span>}
      </div>
      <p className="help" id={`${id}-d`}>
        {t(`phoneSettings.${spec.key}.desc` as MessageKey)}
      </p>
      {spec.key === "nfc" && <p className="help" id={`${id}-nfc-help`}>{t("phoneSettings.nfc.help")}</p>}
      <PickGroup
        name={`${id}-mode`}
        value={shown.mode}
        options={modeOptions}
        onChange={pickMode}
        disabled={disabled}
        labelledBy={`${id}-n`}
        describedBy={spec.key === "nfc" ? `${id}-d ${id}-nfc-help` : `${id}-d`}
      />
      {choices && (
        <div className="setting-value">
          <label htmlFor={`${id}-v`}>{t(`phoneSettings.value.${spec.key}` as MessageKey)}</label>
          <select id={`${id}-v`} value={String(shown.value)} disabled={disabled} onChange={(e) => pickValue(e.target.value)}>
            {choices.map((c) => (
              <option key={String(c)} value={String(c)}>
                {formatSettingValue(spec.key, c, t)}
              </option>
            ))}
          </select>
        </div>
      )}
      {dirty && draft && (
        <div className="setting-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void commit(draft)}>
            {busy ? t("app.saving") : t("app.save")}
          </button>
          <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => setDraft(null)}>
            {t("app.cancel")}
          </button>
        </div>
      )}
      {spec.key === "location" && phone.locationEnabled && <p className="help setting-note">{t("phoneSettings.findNote")}</p>}
    </li>
  );
}


function SetupUndoSetting() {
  const { t } = useI18n();
  const { phone, run } = usePhone();
  const id = useId();
  const path = `/phones/${phone.id}/setup-undo`;
  const res = useLoad(() => api.get<{ minutes: number; editable: boolean; undoUntil: string | null }>(path), [path]);
  const [saving, setSaving] = useState(false);
  const { data, loading, reload } = res;
  const undoUntil = data?.undoUntil;

  useEffect(() => {
    if (undoUntil || loading || saving) return;
    const timer = window.setTimeout(() => {
      if (!document.hidden) void reload();
    }, 10_000);
    function refreshOnReturn() {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void reload();
      }
    }
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [undoUntil, loading, saving, reload]);

  return <LoadGate res={res}>{({ minutes, editable, undoUntil }) => (
    <div className="stack">
      <label htmlFor={id}>{t("setupUndo.label")}</label>
      <select id={id} value={minutes} disabled={!editable || saving} onChange={async (e) => {
        const selected = Number(e.target.value);
        setSaving(true);
        try {
          await run(() => api.put(path, { minutes: selected }), t("app.saved"));
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
        } finally {
          await res.reload();
          setSaving(false);
        }
      }}>
        {[0, 5, 10, 30, 60].map((value) => <option key={value} value={value}>
          {value === 0 ? t("setupUndo.off") : t("setupUndo.minutes", { minutes: value })}
        </option>)}
      </select>
      {undoUntil && minutes > 0 ? <SetupUndoDeadline undoUntil={undoUntil} /> :
        <p className="help">{t(editable ? "setupUndo.help" : "setupUndo.closed")}</p>}
    </div>
  )}</LoadGate>;
}

function SetupUndoDeadline({ undoUntil }: { undoUntil: string }) {
  const { locale, t } = useI18n();
  const deadline = new Date(undoUntil);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const remaining = Date.parse(undoUntil) - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [undoUntil]);

  return <p className="help">{deadline.getTime() > now
    ? t("setupUndo.until", { time: deadline.toLocaleTimeString(intlLocale(locale), {
      hour: "2-digit", minute: "2-digit",
    }) })
    : t("setupUndo.ended")}</p>;
}
