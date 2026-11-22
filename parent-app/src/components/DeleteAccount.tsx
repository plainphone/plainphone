// SPDX-License-Identifier: Apache-2.0
//
// Settings → Delete my account, as in the PWA's Settings (web/src/pages/Settings.tsx). App stores
// ask for this path inside the app; plainphone.org/delete-account/ explains it and the way without
// the app. What the server deletes is in docs/account-deletion.md.
import { useRouter } from "expo-router";
import { useState } from "react";
import { ApiError, client, unwrap } from "../api/client";
import { useI18n } from "../i18n/I18n";
import { useMe, useSession } from "../lib/session";
import { Button, Card, errorMessage, Field, LiveStatus, Text } from "./ui";

type Blocking = { id: string; name: string };

export function DeleteAccount() {
  const { t } = useI18n();
  const me = useMe();
  const { logout } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<Blocking[]>([]);
  const matches = email.trim().toLowerCase() === me.user.email;

  async function del() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    setBlocking([]);
    try {
      await unwrap(client.DELETE("/me", { body: { confirmEmail: email.trim() } }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Name the phones that stand in the way: each has a key, so removing it waits for the key.
        const ids = new Set((err.data as { selfPhoneIds?: string[] }).selfPhoneIds ?? []);
        const { phones } = await unwrap<{ phones: Blocking[] }>(client.GET("/phones")).catch(() => ({ phones: [] as Blocking[] }));
        setBlocking(phones.filter((p) => ids.has(p.id)));
        setError(t("settings.deleteSelfFirst"));
      } else {
        setError(errorMessage(err, t));
      }
      setBusy(false);
      return;
    }
    // The server already ended every session of the account; this clears what the app keeps.
    await logout();
  }

  if (!open) {
    return <Button kind="secondary" title={t("settings.delete")} testID="delete-account" onPress={() => setOpen(true)} />;
  }
  return (
    <Card>
      <Text variant="heading">{t("settings.delete")}</Text>
      <Text>{t("settings.deleteAccount")}</Text>
      <Text>{t("settings.deleteShared")}</Text>
      <Text>{t("settings.deletePhones")}</Text>
      <Field
        testID="delete-account-email"
        label={t("settings.deleteConfirmLabel")}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <LiveStatus notice={error ? { tone: "error", text: error } : null} />
      {blocking.map((p) => (
        <Button key={p.id} kind="plain" title={p.name} onPress={() => router.push(`/phones/${p.id}` as never)} />
      ))}
      <Button kind="danger" title={t("settings.deleteYes")} testID="delete-account-confirm" busy={busy}
        disabled={!matches} onPress={() => void del()} />
      <Button kind="secondary" title={t("app.cancel")} disabled={busy} onPress={() => setOpen(false)} />
    </Card>
  );
}
