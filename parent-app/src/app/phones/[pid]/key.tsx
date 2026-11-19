// SPDX-License-Identifier: Apache-2.0
import { Redirect } from "expo-router";
import { useState } from "react";
import { Share } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { ChangeResult, KeyInput, SelfKey } from "../../../api/models";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, Choice, errorMessage, Field, LoadGate, Notice, PageTitle, Screen, Stack as VStack, Switch, Text, useLoad } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { useMe } from "../../../lib/session";
import { EMAIL_RE } from "../../../lib/validate";
import { formatMoney } from "../../../shared/lib/format";

function KeyLoader() {
  const { t } = useI18n();
  const { phone } = usePhone();
  const res = useLoad(() => unwrap<SelfKey>(client.GET("/phones/{pid}/key", { params: { path: { pid: phone.id } } })), [phone.id]);
  return (
    <Screen testID="phone-key" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("key.intro")}>{t("key.title")}</PageTitle>
      <LoadGate res={res}>
        {(key) => (
          // A new key from the server (after saving) starts the form afresh.
          <KeyForm
            key={`${key.keyType}/${key.delayHours}/${key.trustedEmail}/${key.trustedAccepted}`}
            current={key}
            onSaved={() => void res.reload()}
          />
        )}
      </LoadGate>
    </Screen>
  );
}

function KeyForm({ current, onSaved }: { current: SelfKey; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const { phone, run, notify } = usePhone();
  const [keyType, setKeyType] = useState(current.keyType);
  const [hours, setHours] = useState(String(current.delayHours));
  const [email, setEmail] = useState(current.trustedEmail ?? "");
  const [qrInvite, setQrInvite] = useState(current.keyType === "trusted" && !current.trustedEmail);
  const [errors, setErrors] = useState<{ hours?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);
  const waitingForInvite = current.keyType === "trusted" && !current.trustedEmail && !current.trustedAccepted;

  async function shareInvite() {
    try {
      const invite = await unwrap<{ url: string }>(client.POST("/phones/{pid}/trusted-invite", { params: { path: { pid: phone.id } } }));
      if (invite) await Share.share({ message: invite.url });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    }
  }

  async function submit() {
    const h = Number(hours);
    const mail = email.trim().toLowerCase();
    const next: typeof errors = {};
    if (!Number.isInteger(h) || h < 1 || h > 72) next.hours = t("key.hoursInvalid");
    if (keyType === "trusted" && !qrInvite && (!EMAIL_RE.test(mail) || mail === me.user.email)) next.email = t("key.emailInvalid");
    setErrors(next);
    if (next.hours || next.email) return;
    const body: KeyInput = {
      keyType,
      delayHours: h,
      trustedEmail: keyType === "trusted" && !qrInvite ? mail : null,
      ...(keyType === "trusted" && qrInvite ? { qrInvite: true } : {}),
      // Pay to unlock is not offered yet: send the stored values back unchanged.
      payUnlockEnabled: current.payUnlockEnabled,
      payUnlockAmount: current.payUnlockAmount,
      payUnlockRecipient: current.payUnlockRecipient,
    };
    setSaving(true);
    try {
      const r = await run(
        () => unwrap<ChangeResult>(client.PUT("/phones/{pid}/key", { params: { path: { pid: phone.id } }, body })),
        t("app.saved"),
      );
      if (r?.status === "applied") onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        const f = err.fields();
        setErrors({ hours: f.delayHours ? t("key.hoursInvalid") : undefined, email: f.trustedEmail ? t("key.emailInvalid") : undefined });
      } else notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <VStack>
      {current.keyType === "trusted" && current.trustedEmail ? (
        <Notice
          tone={current.trustedAccepted ? "success" : "info"}
          text={t(current.trustedAccepted ? "key.accepted" : "key.notAccepted", { email: current.trustedEmail })}
        />
      ) : null}
      {current.keyType === "trusted" && !current.trustedEmail ? (
        <Notice
          tone={current.trustedAccepted ? "success" : "info"}
          text={t(current.trustedAccepted ? "key.qrAccepted" : "key.qrWaiting")}
        />
      ) : null}
      <Choice<KeyInput["keyType"]>
        label={t("key.type")}
        value={keyType}
        onChange={setKeyType}
        options={[
          { value: "delay", label: t("key.delay"), help: t("key.delayHelp") },
          { value: "trusted", label: t("key.trusted"), help: t("key.trustedHelp") },
        ]}
      />
      {keyType === "delay" ? (
        <Field
          testID="key-hours"
          label={t("key.hours")}
          help={t("key.hoursHelp")}
          error={errors.hours}
          value={hours}
          onChangeText={setHours}
          keyboardType="number-pad"
          maxLength={2}
          autoComplete="off"
        />
      ) : (
        <Switch testID="key-qr-invite" label={t("key.qrInvite")} value={qrInvite} onValueChange={setQrInvite} />
      )}
      {keyType === "trusted" && !qrInvite ? (
        <Field
          testID="key-email"
          label={t("key.email")}
          help={t("key.emailHelp")}
          error={errors.email}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      ) : null}
      {waitingForInvite && keyType === "trusted" && qrInvite ? (
        <VStack>
          <Button testID="key-share-invite" title={t("key.openInvite")} onPress={() => void shareInvite()} />
          <Text variant="small">{t("key.qrExpiredHint")}</Text>
        </VStack>
      ) : null}

      {/* Pay to unlock only ever applies to the delay key (D13). */}
      {keyType === "delay" ? (
        <Card>
          <Text variant="heading">{t("key.payTitle")}</Text>
          <Notice tone="info" text={t("key.payNotYet")} />
          <Text variant="small">{t("key.payHelp")}</Text>
          <Switch label={t("key.payEnabled")} value={current.payUnlockEnabled} disabled onValueChange={() => undefined} />
          <Field
            label={t("key.payAmount")}
            value={formatMoney(current.payUnlockAmount, current.payUnlockCurrency, locale)}
            editable={false}
          />
          <VStack gap={4}>
            <Text variant="label">{t("key.payRecipient")}</Text>
            <Text>{t("key.recipient.plainphone")}</Text>
          </VStack>
        </Card>
      ) : null}

      <Text variant="small">{t("key.looseningNote")}</Text>
      <Button testID="key-save" title={saving ? t("app.saving") : t("app.save")} busy={saving} onPress={() => void submit()} />
    </VStack>
  );
}

function KeyGate() {
  const { phone } = usePhone();
  // Only Self phones have a key.
  if (phone.profile !== "self") return <Redirect href={{ pathname: "/phones/[pid]", params: { pid: phone.id } }} />;
  return <KeyLoader />;
}

export default function KeyScreen() {
  return (
    <PhoneGate>
      <KeyGate />
    </PhoneGate>
  );
}
