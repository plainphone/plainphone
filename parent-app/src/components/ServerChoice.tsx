// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { HOSTED_SERVER } from "../lib/config";
import { useSession } from "../lib/session";
import { Disclosure } from "./parts";
import { Button, Field, LiveStatus, Text } from "./ui";

export function ServerChoice({ disabled, signsOut }: { disabled?: boolean; signsOut?: boolean }) {
  const { t } = useI18n();
  const { serverUrl, changeServer } = useSession();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function select(value: string | null) {
    setBusy(true);
    setFailed(false);
    try {
      await changeServer(value);
      setAddress("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Text variant="muted">{t("native.serverHelp", { host: serverUrl })}</Text>
      <Disclosure title={t("native.customServer")}>
        {signsOut ? <Text variant="muted">{t("native.serverSignsOut")}</Text> : null}
        <Field label={t("native.serverAddress")} value={address} onChangeText={setAddress}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!disabled && !busy} />
        <LiveStatus notice={failed ? { tone: "error", text: t("native.serverError") } : null} />
        <Button kind="secondary" title={t("native.connectServer")} busy={busy}
          disabled={disabled || !address.trim()} onPress={() => void select(address)} />
        {serverUrl !== HOSTED_SERVER ? (
          <Button kind="secondary" title={t("native.hostedServer")} disabled={disabled || busy}
            onPress={() => void select(null)} />
        ) : null}
      </Disclosure>
    </>
  );
}
