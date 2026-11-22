// SPDX-License-Identifier: Apache-2.0
//
// The pieces shared by setup and the phone's screens: the age picker, the review reminder and the
// family agreement text boxes (docs/age-presets.md, docs/family-agreement.md). Same copy as the
// dashboard (@plainphone/shared). All controlled, so setup can hold the choices until the phone exists.
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
import { Choice, Field, Segmented, Stack, Switch } from "./ui";

/** Pick an age (or none): each choice says what it sets, before anything is changed. */
export function AgePicker({ presets, value, onChange, disabled }: {
  presets: readonly AgePreset[];
  value: AgePresetId | null;
  onChange: (value: AgePresetId | null) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Choice<string>
      testID="age-picker"
      label={t("age.presetLabel")}
      value={value ?? "none"}
      disabled={disabled}
      onChange={(v) => onChange(v === "none" ? null : (v as AgePresetId))}
      options={[
        ...AGE_PRESET_IDS.map((id) => {
          const preset = presets.find((p) => p.id === id);
          return { value: id as string, testID: `age-${id}`, label: presetName(t, id), help: preset ? presetLines(t, preset).join(". ") : undefined };
        }),
        { value: "none", testID: "age-none", label: t("age.none"), help: t("age.noneHelp") },
      ]}
    />
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
    <Stack>
      <Switch testID="review-switch" label={t("age.review.switch")} help={t("age.review.help")} value={enabled} disabled={disabled} onValueChange={onEnabled} />
      {enabled ? (
        <Segmented<number>
          testID="review-interval"
          label={t("age.review.every")}
          value={months}
          onChange={(n) => !disabled && onMonths(n)}
          options={REVIEW_INTERVALS.map((n) => ({ value: n, testID: `review-${n}`, label: n === 1 ? t("age.review.month") : t("age.review.months", { n }) }))}
        />
      ) : null}
    </Stack>
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
  const problems = agreementProblems(draft);
  const message = (p: "tooLong" | "tooMany" | null, max: number) =>
    p === "tooLong" ? t("age.agreement.tooLong", { max: AGREEMENT_LINE_MAX }) : p === "tooMany" ? t("age.agreement.tooMany", { max }) : undefined;
  return (
    <Stack>
      <Field
        testID="agreement-lines"
        label={t("age.agreement.lines")}
        help={`${t("age.agreement.linesHelp")} ${t("age.agreement.counter", { n: parseLines(draft.lines).length, max: AGREEMENT_LINES_MAX })}`}
        error={message(problems.lines, AGREEMENT_LINES_MAX)}
        value={draft.lines}
        editable={!disabled}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
        style={{ minHeight: 120 }}
        onChangeText={(lines) => onChange({ ...draft, lines })}
      />
      <Field
        testID="agreement-adult-lines"
        label={t("age.agreement.adults")}
        help={`${t("age.agreement.adultsHelp")} ${t("age.agreement.counter", { n: parseLines(draft.adultLines).length, max: AGREEMENT_ADULT_LINES_MAX })}`}
        error={message(problems.adultLines, AGREEMENT_ADULT_LINES_MAX)}
        value={draft.adultLines}
        editable={!disabled}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        style={{ minHeight: 80 }}
        onChangeText={(adultLines) => onChange({ ...draft, adultLines })}
      />
    </Stack>
  );
}
