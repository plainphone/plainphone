// SPDX-License-Identifier: Apache-2.0
//
// The extended family roster of one Child phone (docs/extended-family.md). Same states and copy as
// the dashboard (web/src/components/ExtendedFamily). Parents never see the messages.
import { useState } from "react";
import { Alert, Share, View } from "react-native";
import { client, unwrap, ApiError } from "../api/client";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "../shared/i18n/translate";
import {
  canRenewLink,
  EXTENDED_NAME_LENGTH,
  type ContactGroupId,
  type ExtendedContact,
  type ExtendedInvite,
  type ExtendedRoster,
  STATE_KEYS,
} from "../shared/lib/extended-family";
import { Button, Card, Field, Row, Segmented, Stack as VStack, Text, useLoad } from "./ui";

const GROUPS: ContactGroupId[] = ["family", "friends", "others"];

export function ExtendedFamily({ pid }: { pid: string }) {
  const { t } = useI18n();
  const params = { path: { pid } };
  const res = useLoad(() => unwrap<ExtendedRoster>(client.GET("/phones/{pid}/extended", { params })), [pid]);
  const { reload, data } = res;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [invite, setInvite] = useState<ExtendedInvite | null>(null);

  async function run(fn: () => Promise<void>, fail: MessageKey) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && fail === "ext.inviteError") setError("ext.inviteOff");
      else if (err instanceof ApiError && err.status === 409 && fail === "ext.inviteError") setError("ext.inviteFull");
      else setError(fail);
    } finally {
      setBusy(false);
    }
  }

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void run(async () => {
      setInvite(await unwrap<ExtendedInvite>(client.POST("/phones/{pid}/extended", { params, body: { name: trimmed } })));
      setName("");
    }, "ext.inviteError");
  };
  const renew = (c: ExtendedContact) => run(async () => {
    setInvite(await unwrap<ExtendedInvite>(client.POST("/phones/{pid}/extended/{cid}/link", { params: { path: { pid, cid: c.id } } })));
  }, "ext.newLinkError");
  const remove = (c: ExtendedContact) => Alert.alert(t("ext.remove"), t("ext.removeConfirm", { name: c.name }), [
    { text: t("app.cancel"), style: "cancel" },
    { text: t("ext.remove"), style: "destructive", onPress: () => void run(async () => {
      await unwrap(client.DELETE("/phones/{pid}/extended/{cid}", { params: { path: { pid, cid: c.id } } }));
      if (invite?.contact.id === c.id) setInvite(null);
    }, "ext.removeError") },
  ]);
  const regroup = (c: ExtendedContact, group: ContactGroupId) => run(async () => {
    await unwrap(client.PATCH("/phones/{pid}/extended/{cid}", { params: { path: { pid, cid: c.id } }, body: { group } }));
  }, "ext.groupError");

  if (!data) return res.error ? <Text variant="small">{t("ext.unavailable")}</Text> : null;
  return (
    <VStack gap={12}>
      <Text variant="label" accessibilityRole="header">{t("ext.title")}</Text>
      <Text variant="small">{t("ext.intro")}</Text>
      {data.contacts.length === 0 ? <Text variant="muted">{t("ext.empty")}</Text> : null}
      {data.contacts.map((c) => (
        <Card key={c.id} testID={`extended-${c.id}`}>
          <VStack gap={8}>
            <Text variant="label">{c.name}</Text>
            <Text variant="small" accessibilityLiveRegion="polite">{t(STATE_KEYS[c.status], { name: c.name })}</Text>
            <Segmented label={t("ext.groupFor", { name: c.name })} value={c.group}
              options={GROUPS.map((g) => ({ value: g, label: t(`group.${g}` as MessageKey), testID: `extended-${c.id}-${g}` }))}
              onChange={(g) => { if (g !== c.group && !busy) void regroup(c, g); }} />
            <Row>
              {canRenewLink(c.status) ? (
                <Button testID={`extended-${c.id}-renew`} kind="secondary" title={t("ext.newLink")} disabled={busy}
                  accessibilityLabel={`${t("ext.newLink")}: ${c.name}`} onPress={() => void renew(c)} />
              ) : null}
              <Button testID={`extended-${c.id}-remove`} kind="secondary" title={t("ext.remove")} disabled={busy}
                accessibilityLabel={`${t("ext.remove")}: ${c.name}`} onPress={() => remove(c)} />
            </Row>
          </VStack>
        </Card>
      ))}
      <Text variant="small">{t("ext.groupHelp")}</Text>
      {data.contacts.some((c) => canRenewLink(c.status)) ? <Text variant="small">{t("ext.newLinkHelp")}</Text> : null}
      {invite ? <LinkOnce invite={invite} onDone={() => setInvite(null)} /> : null}
      <Field label={t("ext.inviteName")} help={t("ext.inviteNameHelp")} value={name} onChangeText={setName}
        maxLength={EXTENDED_NAME_LENGTH} autoComplete="off" testID="extended-name" />
      <Button testID="extended-invite" title={t("ext.invite")} busy={busy} disabled={!name.trim()} onPress={create} />
      {error ? <Text variant="error" accessibilityRole="alert">{t(error)}</Text> : null}
    </VStack>
  );
}

/** The single-use link, shown once: it is gone when the parent presses Done or leaves the screen. */
function LinkOnce({ invite, onDone }: { invite: ExtendedInvite; onDone: () => void }) {
  const { t } = useI18n();
  const who = { name: invite.contact.name };
  return (
    <Card testID="extended-link">
      <View style={{ gap: 8 }}>
        <Text variant="label">{t("ext.linkFor", who)}</Text>
        <Text>{t("ext.linkOnce", who)}</Text>
        <Text selectable testID="extended-link-text">{invite.link}</Text>
        <Button testID="extended-share" title={t("ext.share")} onPress={() => void Share.share({ message: invite.link }).catch(() => undefined)} />
        <Button testID="extended-done" kind="secondary" title={t("ext.done")} onPress={onDone} />
      </View>
    </Card>
  );
}
