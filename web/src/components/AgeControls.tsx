// SPDX-License-Identifier: Apache-2.0
//
// The pieces shared by setup and the phone's pages: the age picker, the review reminder and the
// family agreement text boxes (docs/age-presets.md, docs/family-agreement.md). All controlled, so
// setup can hold the choices until the phone exists.
import { useId } from "react";
import { useI18n } from "../i18n/I18n";
import {
  AGE_PRESET_IDS,
  AGREEMENT_ADULT_LINES_MAX,
  AGREEMENT_LINE_MAX,
  AGREEMENT_LINES_MAX,
  type AgePreset,
  type AgePresetId,
  linesProblem,
  parseLines,
  presetLines,
  presetName,
  REVIEW_INTERVALS,
} from "@plainphone/shared/age";
import { Field, Switch } from "./ui";

/** Pick an age (or none): each choice says what it sets, before anything is changed. */
export function AgePicker({ presets, value, onChange, name, disabled }: {
  presets: readonly AgePreset[];
  value: AgePresetId | null;
  onChange: (value: AgePresetId | null) => void;
  name: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="choices" disabled={disabled}>
      <legend className="sr-only">{t("age.presetLabel")}</legend>
      {AGE_PRESET_IDS.map((id) => {
        const preset = presets.find((p) => p.id === id);
        return (
          <label key={id} className="choice">
            <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} />
            <span>
              <span className="choice-title">{presetName(t, id)}</span>
              {preset && presetLines(t, preset).map((line) => <span key={line} className="choice-desc">{line}</span>)}
            </span>
          </label>
        );
      })}
      <label className="choice">
        <input type="radio" name={name} value="none" checked={value === null} onChange={() => onChange(null)} />
        <span>
          <span className="choice-title">{t("age.none")}</span>
          <span className="choice-desc">{t("age.noneHelp")}</span>
        </span>
      </label>
    </fieldset>
  );
}

/** The review reminder's switch and how often it comes. */
export function ReviewPicker({ enabled, months, onEnabled, onMonths, disabled }: {
  enabled: boolean;
  months: number;
  onEnabled: (on: boolean) => void;
  onMonths: (months: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="stack-sm">
      <Switch label={t("age.review.switch")} description={t("age.review.help")} checked={enabled} disabled={disabled} onChange={onEnabled} />
      {enabled && (
        <Field label={t("age.review.every")}>
          {(p) => (
            <select {...p} value={months} disabled={disabled} onChange={(e) => onMonths(Number(e.target.value))}>
              {REVIEW_INTERVALS.map((n) => (
                <option key={n} value={n}>{n === 1 ? t("age.review.month") : t("age.review.months", { n })}</option>
              ))}
            </select>
          )}
        </Field>
      )}
    </div>
  );
}

export interface AgreementDraft {
  lines: string;
  adultLines: string;
}

/** What is wrong with a draft, if anything (also decides whether it can be saved). */
export function agreementProblems(draft: AgreementDraft) {
  return {
    lines: linesProblem(parseLines(draft.lines), AGREEMENT_LINES_MAX),
    adultLines: linesProblem(parseLines(draft.adultLines), AGREEMENT_ADULT_LINES_MAX),
  };
}

/** The two text boxes: what the family agrees (the child's words) and the rules for the adults. */
export function AgreementFields({ draft, onChange, disabled }: {
  draft: AgreementDraft;
  onChange: (draft: AgreementDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const problems = agreementProblems(draft);
  const message = (p: "tooLong" | "tooMany" | null, max: number) =>
    p === "tooLong" ? t("age.agreement.tooLong", { max: AGREEMENT_LINE_MAX }) : p === "tooMany" ? t("age.agreement.tooMany", { max }) : undefined;
  return (
    <div className="stack">
      <Field label={t("age.agreement.lines")} help={t("age.agreement.linesHelp")} error={message(problems.lines, AGREEMENT_LINES_MAX)}>
        {(p) => (
          <>
            <textarea {...p} rows={5} value={draft.lines} disabled={disabled} autoComplete="off"
              onChange={(e) => onChange({ ...draft, lines: e.target.value })} />
            <p className="help" id={`${id}-n1`}>{t("age.agreement.counter", { n: parseLines(draft.lines).length, max: AGREEMENT_LINES_MAX })}</p>
          </>
        )}
      </Field>
      <Field label={t("age.agreement.adults")} help={t("age.agreement.adultsHelp")} error={message(problems.adultLines, AGREEMENT_ADULT_LINES_MAX)}>
        {(p) => (
          <>
            <textarea {...p} rows={3} value={draft.adultLines} disabled={disabled} autoComplete="off"
              onChange={(e) => onChange({ ...draft, adultLines: e.target.value })} />
            <p className="help" id={`${id}-n2`}>{t("age.agreement.counter", { n: parseLines(draft.adultLines).length, max: AGREEMENT_ADULT_LINES_MAX })}</p>
          </>
        )}
      </Field>
    </div>
  );
}
