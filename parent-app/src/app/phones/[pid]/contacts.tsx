// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { ApiError, client, unwrap } from "../../../api/client";
import type { ChangeResult, Contact } from "../../../api/models";
import { ItemRow } from "../../../components/parts";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, errorMessage, Field, List, LoadGate, Notice, PageTitle, Screen, Text, useLoad } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { space } from "../../../lib/theme";
import { cleanNumber, NUMBER_RE } from "../../../lib/validate";

function ContactsList() {
  const { t } = useI18n();
  const { phone, run, pending, notify } = usePhone();
  const res = useLoad(
    () =>
      unwrap<{ contacts: Contact[] }>(client.GET("/phones/{pid}/contacts", { params: { path: { pid: phone.id } } })).then(
        (r) => r.contacts,
      ),
    [phone.id],
  );
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [errors, setErrors] = useState<{ name?: string; number?: string }>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const waitingAdds = pending.flatMap((c) => (c.op.type === "contact.add" ? [c.op] : []));

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
      if (r?.status === "applied") res.setData((list) => list?.filter((x) => x.id !== c.id));
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Screen testID="phone-contacts" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("contacts.intro")}>{t("contacts.title")}</PageTitle>
      <Notice tone="info" text={t("contacts.otherApps")} />

      <LoadGate res={res}>
        {(list) =>
          list.length === 0 && waitingAdds.length === 0 ? (
            <Text variant="muted" style={{ paddingHorizontal: space.xs }}>{t("contacts.empty")}</Text>
          ) : (
            <List>
              {list.map((c) => (
                <ItemRow key={c.id} testID={`contact-${c.id}`} title={c.name} meta={c.number} mono>
                  <Button
                    kind="destructive"
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
            </List>
          )
        }
      </LoadGate>

      <Card>
        <Text variant="heading">{t("contacts.add")}</Text>
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
        <Button testID="contact-add" title={saving ? t("app.saving") : t("contacts.add")} busy={saving} onPress={() => void add()} />
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
