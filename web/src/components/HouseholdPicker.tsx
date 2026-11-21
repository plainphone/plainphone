// SPDX-License-Identifier: Apache-2.0
import { useI18n } from "../i18n/I18n";
import { householdOptionLabel } from "../lib/household";
import { chooseHousehold, useActiveHousehold, useMe } from "../lib/session";
import { Field } from "./ui";

/** Shown only to a parent who is in more than one household: which one this page is about. */
export function HouseholdPicker() {
  const { t } = useI18n();
  const me = useMe();
  const active = useActiveHousehold();
  if (me.households.length < 2 || !active) return null;
  return (
    <Field label={t("house.title")}>
      {(p) => (
        <select {...p} className="input-short" value={active.id} onChange={(e) => chooseHousehold(e.target.value)}>
          {me.households.map((h) => (
            <option key={h.id} value={h.id}>
              {householdOptionLabel(h.name === "Home" ? t("house.title") : h.name, t(h.role === "owner" ? "house.owner" : "house.parent"))}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
