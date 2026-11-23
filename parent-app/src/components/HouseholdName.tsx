// SPDX-License-Identifier: Apache-2.0
import { useRef, useState } from "react";
import { DEFAULT_HOUSEHOLD_NAME } from "@plainphone/shared/household";
import { ApiError, client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import { useSession } from "../lib/session";
import { Button, Card, errorMessage, Field, type NoticeValue } from "./ui";

/** A new household is called "Household" until a parent names it here. The phone shows the name when it connects. */
export function HouseholdName({ household, notify }: {
  household: { id: string; name: string };
  notify: (notice: NoticeValue) => void;
}) {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [name, setName] = useState(household.name === DEFAULT_HOUSEHOLD_NAME ? "" : household.name);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // The keyboard's Done also saves, and it ignores the button's busy state: a second save while
  // the first is on its way could land first and be overwritten by the older name.
  const inFlight = useRef(false);

  async function save() {
    if (inFlight.current) return;
    const value = name.trim();
    if (!value || value.length > 60) {
      setError(t("house.nameInvalid"));
      return;
    }
    // "Home" is how the server marks a household nobody has named; saved, it would read as unnamed again.
    if (value === DEFAULT_HOUSEHOLD_NAME) {
      setError(t("house.nameReserved"));
      return;
    }
    setError(undefined);
    inFlight.current = true;
    setSaving(true);
    try {
      await unwrap(client.PATCH("/households/{hid}", { params: { path: { hid: household.id } }, body: { name: value } }));
      await refresh();
      notify({ tone: "success", text: t("house.nameSaved") });
    } catch (err) {
      // The server holds the same rule, so the answer reads like the form's own check.
      if (err instanceof ApiError && err.data.code === "household_name_reserved") setError(t("house.nameReserved"));
      else notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Card>
      <Field
        testID="household-name"
        label={t("house.nameLabel")}
        help={t("house.nameHelp")}
        error={error}
        value={name}
        onChangeText={setName}
        placeholder={t("house.namePlaceholder")}
        maxLength={60}
        autoComplete="off"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      <Button testID="household-name-save" kind="secondary" title={t("house.nameSave")} busy={saving} onPress={() => void save()} />
    </Card>
  );
}
