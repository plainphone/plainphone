// SPDX-License-Identifier: Apache-2.0
//
// The quick messages of one Child phone: switches, the list to edit, and suggestions from the
// child waiting for an answer. Same states and copy as the dashboard (web/src/components/QuickMessages).
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "../shared/i18n/translate";
import {
  MAX_QUICK_MESSAGES,
  QUICK_MESSAGE_LENGTH,
  type QuickMessage,
  type QuickMessages as QuickMessageList,
  type SosSettings,
  starterMessages,
} from "../shared/lib/sos-options";
import { Button, Card, Field, Row, Stack as VStack, Switch, Text, useLoad } from "./ui";

function MessageForm({ initial, submitLabel, busy, onSubmit, onCancel, testID }: {
  initial?: QuickMessage;
  submitLabel: string;
  busy: boolean;
  onSubmit: (text: string, meansSos: boolean) => Promise<boolean>;
  onCancel?: () => void;
  testID: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial?.text ?? "");
  const [code, setCode] = useState(initial?.meansSos ?? false);

  async function submit() {
    if (!text.trim()) return;
    if (await onSubmit(text.trim(), code) && !initial) {
      setText("");
      setCode(false);
    }
  }

  return (
    <VStack gap={8}>
      <Field label={initial ? t("qm.editLabel", { text: initial.text }) : t("qm.new")} value={text} onChangeText={setText}
        maxLength={QUICK_MESSAGE_LENGTH} autoComplete="off" testID={`${testID}-text`} />
      <Switch testID={`${testID}-code`} label={t("qm.code")} help={t("qm.codeHelp")} value={code} disabled={busy} onValueChange={setCode} />
      <Row>
        <Button testID={`${testID}-submit`} title={submitLabel} busy={busy} disabled={!text.trim()} onPress={() => void submit()} />
        {onCancel ? <Button kind="secondary" title={t("app.cancel")} onPress={onCancel} /> : null}
      </Row>
    </VStack>
  );
}

export function QuickMessages({ pid, settings, saving, onSetting }: {
  pid: string;
  settings: SosSettings;
  saving: boolean;
  onSetting: (patch: Partial<SosSettings>) => void;
}) {
  const { t } = useI18n();
  const params = { path: { pid } };
  const res = useLoad(() => unwrap<QuickMessageList>(client.GET("/phones/{pid}/quick-messages", { params })), [pid]);
  const { reload, data } = res;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const sending = useRef(false);

  const waiting = data?.suggestions.length ?? 0;
  // A suggestion waiting for an answer opens the section once, so it is not missed.
  const announced = useRef(false);
  useEffect(() => {
    if (waiting > 0 && !announced.current) {
      announced.current = true;
      setOpen(true);
    }
  }, [waiting]);

  // Back from another screen or from the background: the child may have suggested something meanwhile.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) firstFocus.current = false;
    else void reload();
  }, [reload]));

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    if (sending.current) return false;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "qm.full" : "qm.error");
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const messages = data?.messages ?? [];
  const full = messages.length >= MAX_QUICK_MESSAGES;
  const add = (text: string, meansSos = false) =>
    run(() => unwrap(client.POST("/phones/{pid}/quick-messages", { params, body: { text, meansSos } })));
  const answer = (id: string, meansSos: boolean) => run(() => unwrap(client.POST("/phones/{pid}/quick-messages/{id}/approve", {
    params: { path: { pid, id } }, body: { meansSos },
  })));

  return (
    <Card testID="quick-messages">
      <Button kind="plain" testID="quick-messages-toggle" title={`${t("qm.title")}${waiting > 0 ? ` (${waiting})` : ""}`}
        onPress={() => setOpen(!open)} />
      {open ? (
        <VStack gap={12}>
          <Switch testID="qm-enabled" label={t("qm.enabled")} help={t("qm.enabledHelp")} value={settings.quickMessagesEnabled}
            disabled={saving} onValueChange={(on) => onSetting({ quickMessagesEnabled: on })} />
          <Switch testID="qm-suggest" label={t("qm.suggest")} help={t("qm.suggestHelp")} value={settings.quickSuggestionsEnabled}
            disabled={saving} onValueChange={(on) => onSetting({ quickSuggestionsEnabled: on })} />

          {waiting > 0 ? (
            <VStack gap={8}>
              <Text variant="heading">{t("qm.fromChild")}</Text>
              {data?.suggestions.map((s) => (
                <VStack key={s.id} gap={8}>
                  <Text variant="label">{s.text}</Text>
                  <Row>
                    <Button testID={`qm-approve-${s.id}`} title={t("qm.approve")} accessibilityLabel={`${t("qm.approve")}: ${s.text}`}
                      disabled={busy} onPress={() => void answer(s.id, false)} />
                    <Button testID={`qm-approve-code-${s.id}`} kind="secondary" title={t("qm.approveCode")}
                      accessibilityLabel={`${t("qm.approveCode")}: ${s.text}`} disabled={busy} onPress={() => void answer(s.id, true)} />
                    <Button testID={`qm-decline-${s.id}`} kind="secondary" title={t("qm.decline")} accessibilityLabel={`${t("qm.decline")}: ${s.text}`}
                      disabled={busy} onPress={() => void run(() => unwrap(client.POST("/phones/{pid}/quick-messages/{id}/decline", {
                        params: { path: { pid, id: s.id } },
                      })))} />
                  </Row>
                </VStack>
              ))}
            </VStack>
          ) : null}

          {data ? (
            <VStack gap={8}>
              <Text variant="heading">{t("qm.list", { n: messages.length, max: MAX_QUICK_MESSAGES })}</Text>
              {messages.map((m) => editing === m.id ? (
                <MessageForm key={m.id} testID={`qm-edit-${m.id}`} initial={m} submitLabel={t("app.save")} busy={busy}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (text, meansSos) => {
                    const ok = await run(() => unwrap(client.PATCH("/phones/{pid}/quick-messages/{id}", {
                      params: { path: { pid, id: m.id } }, body: { text, meansSos },
                    })));
                    if (ok) setEditing(null);
                    return ok;
                  }} />
              ) : (
                <VStack key={m.id} gap={4}>
                  <Text testID={`qm-${m.id}`} variant="label">{m.meansSos ? `${m.text} (${t("qm.codeBadge")})` : m.text}</Text>
                  <Row>
                    <Button testID={`qm-edit-button-${m.id}`} kind="secondary" title={t("qm.edit")}
                      accessibilityLabel={t("qm.editLabel", { text: m.text })} disabled={busy} onPress={() => setEditing(m.id)} />
                    <Button testID={`qm-delete-${m.id}`} kind="secondary" title={t("qm.delete")}
                      accessibilityLabel={t("qm.deleteLabel", { text: m.text })} disabled={busy}
                      onPress={() => void run(() => unwrap(client.DELETE("/phones/{pid}/quick-messages/{id}", {
                        params: { path: { pid, id: m.id } },
                      })))} />
                  </Row>
                </VStack>
              ))}

              {messages.length === 0 ? (
                <VStack gap={8}>
                  <Text variant="small">{t("qm.emptyIntro")}</Text>
                  <Row>
                    {starterMessages(settings).map((key) => (
                      <Button key={key} testID={`qm-starter-${key}`} kind="secondary" title={t(key)} disabled={busy}
                        onPress={() => void add(t(key))} />
                    ))}
                  </Row>
                </VStack>
              ) : null}

              {!full && editing === null ? <MessageForm testID="qm-new" submitLabel={t("app.add")} busy={busy} onSubmit={add} /> : null}
              {full ? <Text variant="small">{t("qm.max", { max: MAX_QUICK_MESSAGES, chars: QUICK_MESSAGE_LENGTH })}</Text> : null}
            </VStack>
          ) : res.error ? <Text variant="small">{t("qm.unavailable")}</Text> : null}
          {error ? <Text accessibilityRole="alert">{t(error, { max: MAX_QUICK_MESSAGES })}</Text> : null}
        </VStack>
      ) : null}
    </Card>
  );
}
