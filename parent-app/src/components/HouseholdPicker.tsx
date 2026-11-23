// SPDX-License-Identifier: Apache-2.0
import { useI18n } from "../i18n/I18n";
import { chooseHousehold } from "../lib/household-choice";
import { useActiveHousehold, useMe } from "../lib/session";
import { householdOptionLabel, householdTitle } from "@plainphone/shared/household";
import { Choice } from "./ui";

/** Shown only to a parent who is in more than one household: which one this screen is about. */
export function HouseholdPicker() {
  const { t } = useI18n();
  const me = useMe();
  const active = useActiveHousehold();
  if (me.households.length < 2 || !active) return null;
  return (
    <Choice
      testID="household-picker"
      label={t("house.title")}
      value={active.id}
      options={me.households.map((h) => ({
        value: h.id,
        label: householdOptionLabel(householdTitle(h.name, t("house.title")), t(h.role === "owner" ? "house.owner" : "house.parent")),
        testID: `household-option-${h.id}`,
      }))}
      onChange={(id) => void chooseHousehold(id)}
    />
  );
}
