// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { Field, Switch } from "./ui";

/**
 * "Ask for a callback" for one Child phone (docs/sos.md#asking-a-parent-to-call): the phone's own
 * number, a parent's confirmation of it, and the switch. The switch needs a confirmed number.
 */
export function CallbackSettings({ number, confirmed, enabled, saving, error, onSave, onSwitch }: {
  number: string | null;
  confirmed: boolean;
  enabled: boolean;
  saving: boolean;
  error: boolean;
  onSave: (number: string | null, confirmed: boolean) => Promise<void>;
  onSwitch: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const value = draft ?? number ?? "";
  const changed = draft !== null && draft.trim() !== (number ?? "");
  // A saved number nobody confirmed can be confirmed as it is.
  const canSave = !saving && sure && (changed ? draft.trim() !== "" : Boolean(number) && !confirmed);
  const canClear = !saving && number !== null && draft === null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    await onSave(changed ? draft.trim() : number, true);
    setDraft(null);
    setSure(false);
  }

  return (
    <details className="form-card sos-options" id="callback-settings">
      <summary>{t("cb.title")}</summary>
      <div className="stack">
        <Switch label={t("cb.title")} description={t("cb.help")} checked={enabled}
          disabled={saving || !confirmed} onChange={onSwitch} />
        {!confirmed && <p className="help">{number ? t("cb.unconfirmed") : t("cb.needNumber")}</p>}
        <form className="stack" onSubmit={(e) => void submit(e)}>
          <Field label={t("cb.number")} help={t("cb.numberHelp")}>
            {(props) => (
              <input {...props} type="tel" autoComplete="off" placeholder="+45" value={value}
                onChange={(e) => { setDraft(e.target.value); setSure(false); }} />
            )}
          </Field>
          <label><input type="checkbox" checked={sure} disabled={saving} onChange={(e) => setSure(e.target.checked)} /> {t("cb.confirm")}</label>
          <div className="actions">
            <button className="btn btn-secondary" disabled={!canSave}>{t("cb.saveNumber")}</button>
            {canClear && <button type="button" className="btn btn-secondary" onClick={() => void onSave(null, false)}>{t("app.remove")}</button>}
          </div>
        </form>
        {error && <p role="alert">{t("cb.error")}</p>}
      </div>
    </details>
  );
}
