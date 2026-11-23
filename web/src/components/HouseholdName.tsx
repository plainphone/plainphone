// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { DEFAULT_HOUSEHOLD_NAME } from "@plainphone/shared/household";
import { useI18n } from "../i18n/I18n";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { errorMessage, Field, type Notice } from "./ui";

/** A new household is called "Household" until a parent names it here. The phone shows the name when it connects. */
export function HouseholdName({ household, notify }: {
  household: { id: string; name: string };
  notify: (notice: Notice) => void;
}) {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [name, setName] = useState(household.name === DEFAULT_HOUSEHOLD_NAME ? "" : household.name);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const value = name.trim();
    if (!value || value.length > 60) {
      setError(t("house.nameInvalid"));
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await api.patch(`/households/${household.id}`, { name: value });
      await refresh();
      notify({ tone: "success", text: t("house.nameSaved") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section">
      <form onSubmit={save} noValidate className="inline-form">
        <Field label={t("house.nameLabel")} help={t("house.nameHelp")} error={error}>
          {(p) => (
            <input {...p} name="household-name" maxLength={60} autoComplete="off" placeholder={t("house.namePlaceholder")}
              value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <button type="submit" className="btn btn-secondary" disabled={saving}>
          {t("house.nameSave")}
        </button>
      </form>
    </section>
  );
}
