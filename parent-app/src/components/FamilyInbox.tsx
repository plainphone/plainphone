// SPDX-License-Identifier: Apache-2.0
//
// The family inbox of one Child phone (docs/family-inbox.md): its switches, the thread and a short
// reply. Same states and copy as the dashboard (web/src/components/FamilyInbox).
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { ApiError, client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import { getItem, removeItem, setItem } from "../lib/storage";
import { space, useColors } from "../lib/theme";
import { formatDateTime } from "../shared/lib/format";
import type { MessageKey } from "../shared/i18n/translate";
import { type FamilyInboxThread, familyState, REPLY_LENGTH, type SosSettings } from "../shared/lib/sos-options";
import { ExtendedFamily } from "./ExtendedFamily";
import { SnapshotLine } from "./SnapshotLine";
import { Button, Card, Field, Stack as VStack, Switch, Text, useLoad } from "./ui";

/** The name a parent signs replies with, kept on this device only. */
const NAME_KEY = "pp.inboxName";

export function FamilyInbox({ pid, settings, saving, onSetting }: {
  pid: string;
  settings: SosSettings;
  saving: boolean;
  onSetting: (patch: Partial<SosSettings>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(settings.familyInbox);
  return (
    <Card testID="family-inbox">
      <Button kind="plain" testID="family-inbox-toggle" title={t("inbox.title")} onPress={() => setOpen(!open)} />
      {open ? (
        <VStack gap={12}>
          <Switch testID="inbox-enabled" label={t("inbox.enabled")} help={t("inbox.enabledHelp")} value={settings.familyInbox}
            disabled={saving} onValueChange={(on) => onSetting({ familyInbox: on })} />
          <Switch testID="inbox-check-ins" label={t("inbox.checkIns")}
            help={settings.familyInbox ? t("inbox.checkInsHelp") : `${t("inbox.checkInsHelp")} ${t("inbox.needsInbox")}`}
            value={settings.checkIns} disabled={saving} onValueChange={(on) => onSetting({ checkIns: on })} />
          <Switch testID="inbox-extended" label={t("ext.switch")}
            help={settings.familyInbox ? t("ext.switchHelp") : `${t("ext.switchHelp")} ${t("inbox.needsInbox")}`}
            value={settings.extendedFamily} disabled={saving} onValueChange={(on) => onSetting({ extendedFamily: on })} />
          <Switch testID="inbox-snapshots" label={t("ext.snapSwitch")}
            help={settings.familyInbox ? t("ext.snapSwitchHelp") : `${t("ext.snapSwitchHelp")} ${t("inbox.needsInbox")}`}
            value={settings.locationSnapshots} disabled={saving} onValueChange={(on) => onSetting({ locationSnapshots: on })} />
          <Text variant="small">{t("inbox.quickNote")}</Text>
          <Text variant="small">{t("inbox.privacy")}</Text>
          {settings.familyInbox ? <Thread pid={pid} /> : null}
          {/* Paused (either switch off) still shows the people already on the list, so they can be removed. */}
          <ExtendedFamily pid={pid} paused={!settings.familyInbox || !settings.extendedFamily} />
        </VStack>
      ) : null}
    </Card>
  );
}

function Thread({ pid }: { pid: string }) {
  const { t, locale } = useI18n();
  const c = useColors();
  const params = { path: { pid } };
  const res = useLoad(() => unwrap<FamilyInboxThread>(client.GET("/phones/{pid}/inbox", { params })), [pid]);
  const { reload, data } = res;
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    void getItem(NAME_KEY).then((saved) => { if (saved) setName(saved); });
  }, []);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  async function send() {
    if (!text.trim() || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const signed = name.trim();
      await (signed ? setItem(NAME_KEY, signed) : removeItem(NAME_KEY));
      await unwrap(client.POST("/phones/{pid}/inbox", { params, body: { text: text.trim(), name: signed || undefined } }));
      setText("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "inbox.off" : "inbox.error");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (!data) return res.error ? <Text variant="small">{t("inbox.unavailable")}</Text> : null;
  return (
    <VStack gap={12}>
      {data.messages.length === 0 ? <Text variant="muted">{t("inbox.empty")}</Text> : null}
      {data.messages.map((m) => {
        const state = familyState(m);
        const who = m.from === "child" ? t("inbox.child") : m.author || t("inbox.parent");
        return (
          <View key={m.id} testID={`inbox-${m.id}`} accessible
            style={{
              alignSelf: m.from === "parent" ? "flex-end" : "flex-start", maxWidth: "85%", gap: space.xs,
              borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: space.md,
              backgroundColor: m.from === "parent" ? c.bg : c.surface,
            }}>
            <Text variant="small">{who} · {formatDateTime(m.sentAt, locale)}</Text>
            {m.kind === "snapshot" ? <SnapshotLine location={m.location} /> : <Text>{m.kind === "checkin" ? t("inbox.checkIn") : m.text}</Text>}
            <Text variant="small">{t(state.key, state.at ? { time: formatDateTime(state.at, locale) } : undefined)}</Text>
          </View>
        );
      })}
      <Field label={t("inbox.replyLabel")} value={text} onChangeText={setText} maxLength={REPLY_LENGTH} autoComplete="off" testID="inbox-reply" />
      <Field label={t("inbox.replyName")} help={t("inbox.replyNameHelp")} value={name} onChangeText={setName} maxLength={60}
        autoComplete="given-name" testID="inbox-name" />
      <Button testID="inbox-send" title={t("inbox.send")} busy={busy} disabled={!text.trim()} onPress={() => void send()} />
      {error ? <Text variant="error" accessibilityRole="alert">{t(error)}</Text> : null}
    </VStack>
  );
}
