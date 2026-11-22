// SPDX-License-Identifier: Apache-2.0
import { useI18n } from "../i18n/I18n";
import { languageNames, languages, type PhoneLanguage } from "@plainphone/i18n/phone-language";
import { Choice } from "./ui";

export function PhoneLanguagePicker({ value, onChange, setup, disabled }: {
  value: PhoneLanguage;
  onChange: (value: PhoneLanguage) => void;
  setup?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <Choice
      label={t("phoneLanguage.label")}
      hint={t(setup ? "phoneLanguage.setup" : "phoneLanguage.help")}
      value={value ?? ""}
      onChange={(value) => onChange(value || null)}
      disabled={disabled}
      options={[
        { value: "", label: t("phoneLanguage.system") },
        ...languages.map((value) => ({ value, label: languageNames[value] })),
      ]}
    />
  );
}
