// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { ApiError, client, unwrap } from "../../../api/client";
import type { ChangeResult, Contact } from "../../../api/models";
import { ContactSuggestions, loadContactSuggestions } from "../../../components/ContactSuggestions";
import { ItemRow } from "../../../components/parts";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, errorMessage, Field, LoadGate, Notice, PageTitle, Screen, Stack as VStack, Text, useLoad } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { space } from "../../../lib/theme";
import { cleanNumber, NUMBER_RE } from "../../../lib/validate";

function ContactsList() {
  const { t } = useI18n();
  const { phone, run, pending, notify } = usePhone();
  const self = phone.profile === "self";
  const lightChild = !self && phone.mode === "light";
  const res = useLoad(
    () => unwrap<{ contacts: Contact[]; selfScheduleContacts?: boolean | null; suggestDeviceContacts?: boolean; lightContactRestriction?: boolean }>(
      client.GET("/phones/{pid}/contacts", { params: { path: { pid: phone.id } } }),
    ),
    [phone.id],
  );
  const sharing = !self && res.data?.suggestDeviceContacts === true;
  const suggestions = useLoad(() => sharing ? loadContactSuggestions(phone.id) : Promise.resolve([]), [phone.id, sharing]);
  const addLabel = t(self ? "contacts.addFavourite" : "contacts.add");
  const selfIntro = res.data && t(res.data.selfScheduleContacts === null ? "contacts.selfLegacyIntro" : "contacts.selfIntro");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [errors, setErrors] = useState<{ name?: string; number?: string }>({});
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [sosError, setSosError] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const waitingAdds = pending.flatMap((c) => (c.op.type === "contact.add" ? [c.op] : []));

  async function markParent(contact: Contact) {
    setMarking(true);
    setSosError(false);
    try {
      await unwrap(client.PUT("/phones/{pid}/contacts/{cid}/sos-parent", {
        params: { path: { pid: phone.id, cid: contact.id } },
        body: { enabled: !contact.sosParent },
      }));
      await res.reload();
    } catch {
      setSosError(true);
    } finally {
      setMarking(false);
    }
  }

  async function add() {
    const n = cleanNumber(number);
    const next: typeof errors = {};
    if (!name.trim()) next.name = t("contacts.nameRequired");
    if (!NUMBER_RE.test(n)) next.number = t("contacts.numberInvalid");
    setErrors(next);
    if (next.name || next.number) return;
    setSaving(true);
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(
            client.POST("/phones/{pid}/contacts", { params: { path: { pid: phone.id } }, body: { name: name.trim(), number: n } }),
          ),
        t("contacts.added", { name: name.trim() }),
      );
      if (r) {
        setName("");
        setNumber("");
        if (r.status === "applied") await res.reload();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const f = err.fields();
        setErrors({ name: f.name ? t("contacts.nameRequired") : undefined, number: f.number ? t("contacts.numberInvalid") : undefined });
      } else notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Contact) {
    setRemoving(c.id);
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(client.DELETE("/phones/{pid}/contacts/{cid}", { params: { path: { pid: phone.id, cid: c.id } } })),
        t("contacts.removed"),
      );
      if (r?.status === "applied") {
        res.setData((data) => data && { ...data, contacts: data.contacts.filter((x) => x.id !== c.id) });
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Screen
      testID="phone-contacts"
      onRefresh={() => void Promise.all([res.reload(), suggestions.reload()])}
      refreshing={(res.loading && res.data !== undefined) || (!self && suggestions.loading && suggestions.data !== undefined)}
    >
      <PageTitle sub={self ? selfIntro : lightChild ? undefined : t("contacts.intro")}>{t(self ? "contacts.favourites" : "contacts.title")}</PageTitle>
      {!self && <Notice tone="info" text={t("contacts.otherApps")} />}

      {lightChild && res.data?.lightContactRestriction && res.data.contacts.length === 0 && (
        <Notice tone="info" text={t("contacts.lightEmptyWarning")} />
      )}

      {sosError && <Notice tone="warn" text={t("sos.error")} />}
      <LoadGate res={res}>
        {({ contacts: list }) =>
          list.length === 0 && waitingAdds.length === 0 ? (
            <Text variant="muted">{t(self ? "contacts.noFavourites" : lightChild && !res.data?.lightContactRestriction ? "contacts.emptyUnrestricted" : "contacts.empty")}</Text>
          ) : (
            <VStack gap={space.sm}>
              {list.map((c) => (
                <ItemRow key={c.id} testID={`contact-${c.id}`} title={c.name} meta={c.number} mono>
                  {!self && <Button kind="plain"
                    title={t(c.sosParent ? "sos.unmark" : "sos.mark")}
                    disabled={marking}
                    onPress={() => void markParent(c)} />}
                  <Button
                    kind="secondary"
                    title={t("app.remove")}
                    accessibilityLabel={t("contacts.removeLabel", { name: c.name })}
                    busy={removing === c.id}
                    onPress={() => void remove(c)}
                  />
                </ItemRow>
              ))}
              {waitingAdds.map((op) => (
                <ItemRow key={op.number} title={op.name} meta={op.number} mono tag={t("pending.waitingTag")} waiting />
              ))}
            </VStack>
          )
        }
      </LoadGate>

      {sharing && <ContactSuggestions pid={phone.id} result={suggestions} onApproved={res.reload} />}

      <Card>
        <Text variant="heading">{addLabel}</Text>
        <Field
          testID="contact-name"
          label={t("contacts.name")}
          error={errors.name}
          value={name}
          onChangeText={setName}
          maxLength={60}
          autoComplete="off"
        />
        <Field
          testID="contact-number"
          label={t("contacts.number")}
          help={t("contacts.numberHelp")}
          error={errors.number}
          value={number}
          onChangeText={setNumber}
          keyboardType="phone-pad"
          autoComplete="off"
          placeholder="+45"
        />
        <Button testID="contact-add" title={saving ? t("app.saving") : addLabel} busy={saving} onPress={() => void add()} />
      </Card>
    </Screen>
  );
}

export default function ContactsScreen() {
  return (
    <PhoneGate>
      <ContactsList />
    </PhoneGate>
  );
}
