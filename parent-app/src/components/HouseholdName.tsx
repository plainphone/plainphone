// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { DEFAULT_HOUSEHOLD_NAME } from "@plainphone/shared/household";
import { client, unwrap } from "../api/client";
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

  async function save() {
    const value = name.trim();
    if (!value || value.length > 60) {
      setError(t("house.nameInvalid"));
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await unwrap(client.PATCH("/households/{hid}", { params: { path: { hid: household.id } }, body: { name: value } }));
      await refresh();
      notify({ tone: "success", text: t("house.nameSaved") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
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
