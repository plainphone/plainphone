// SPDX-License-Identifier: Apache-2.0
import { useI18n } from "../i18n/I18n";
import { isLanguage, languageNames, languages, type PhoneLanguage } from "@plainphone/i18n/phone-language";
import { Field } from "./ui";

export function PhoneLanguagePicker({ value, onChange, setup, disabled }: {
  value: PhoneLanguage;
  onChange: (value: PhoneLanguage) => void;
  setup?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Field label={t("phoneLanguage.label")} help={t(setup ? "phoneLanguage.setup" : "phoneLanguage.help")}>
      {(props) => (
        <select {...props} value={value ?? ""} disabled={disabled} onChange={(event) => {
          const chosen = event.target.value;
          onChange(isLanguage(chosen) ? chosen : null);
        }}>
          <option value="">{t("phoneLanguage.system")}</option>
          {languages.map((language) => <option key={language} value={language} lang={language}>{languageNames[language]}</option>)}
        </select>
      )}
    </Field>
  );
}
