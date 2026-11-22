// SPDX-License-Identifier: Apache-2.0
import { Redirect } from "expo-router";
import { useState } from "react";
import { Share } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { ChangeResult, KeyInput, SelfKey } from "../../../api/models";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { EmergencySection } from "../../../components/EmergencyOpenings";
import { Button, Choice, Disclosure, errorMessage, Field, LoadGate, Notice, PageTitle, Screen, Stack as VStack, Switch, Text, useLoad, useSingleFlight } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import type { MessageKey } from "@plainphone/i18n/translate";
import { useMe } from "../../../lib/session";
import { EMAIL_RE } from "../../../lib/validate";
import { usePlan } from "../../../components/Billing";

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
      <EmergencySection />
    </Screen>
  );
}

// The level is only a name for the key: Mild is a 1 hour delay, Firm 24 hours, Strict a trusted
// person. Any other delay is "custom", with no card picked until the user picks one.
type Level = "mild" | "firm" | "strict";
type Picked = Level | "custom";

function choiceOf(key: Pick<SelfKey, "keyType" | "delayHours">): Picked {
  if (key.keyType === "trusted") return "strict";
  return key.delayHours === 1 ? "mild" : key.delayHours === 24 ? "firm" : "custom";
}

function KeyForm({ current, onSaved }: { current: SelfKey; onSaved: () => void }) {
  const { t } = useI18n();
  const plan = usePlan();
  const me = useMe();
  const { phone, run, notify } = usePhone();
  const [choice, setChoice] = useState<Picked>(choiceOf(current));
  // The delay in hours: what Advanced shows for a custom key, and what Strict keeps as its fallback wait.
  const [hours, setHours] = useState(String(current.delayHours));
  const [advancedOpen, setAdvancedOpen] = useState(choiceOf(current) === "custom");
  const [email, setEmail] = useState(current.trustedEmail ?? "");
  const [qrInvite, setQrInvite] = useState(current.keyType === "trusted" && !current.trustedEmail);
  const [errors, setErrors] = useState<{ hours?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);
  const [payUnlock, setPayUnlock] = useState(current.payUnlockEnabled);
  const keyType: KeyInput["keyType"] = choice === "strict" ? "trusted" : "delay";
  // Paid early unlock (docs/billing.md): only with billing on, and only for the user's own delay key.
  // The switch only allows it; buying happens outside this app.
  const offerSwitch = Boolean(plan?.billing) && keyType === "delay";
  const shownHours = choice === "mild" ? "1" : choice === "firm" ? "24" : hours;
  const sentHours = choice === "mild" ? 1 : choice === "firm" ? 24 : Number(hours);
  const waitingForInvite = current.keyType === "trusted" && !current.trustedEmail && !current.trustedAccepted;

  // Two taps in one frame must not create two trusted-person invitations or save twice.
  const once = useSingleFlight();

  const shareInvite = () => once(async () => {
    try {
      const invite = await unwrap<{ url: string }>(client.POST("/phones/{pid}/trusted-invite", { params: { path: { pid: phone.id } } }));
      if (invite) await Share.share({ message: invite.url });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    }
  });

  const submit = () => once(async () => {
    const h = sentHours;
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
      // Without the switch the stored value goes back unchanged. Amount and recipient are legacy and echo as stored.
      payUnlockEnabled: offerSwitch ? payUnlock : current.payUnlockEnabled,
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
  });

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
          text={t(current.trustedAccepted ? "key.qrAccepted" : "key.qrWaiting", { hours: current.delayHours })}
        />
      ) : null}
      <Choice<Picked>
        testID="key-levels"
        label={t("key.type")}
        value={choice}
        onChange={(next) => {
          setChoice(next);
          setErrors({});
        }}
        options={(["mild", "firm", "strict"] as const).map((l) => ({
          value: l,
          label: t(`key.level.${l}` as MessageKey),
          help: t(`key.level.${l}Help` as MessageKey),
          testID: `key-level-${l}`,
        }))}
      />
      {choice === "custom" ? (
        <Text variant="small" testID="key-custom">{t("key.level.custom", { hours: Number(hours) || current.delayHours })}</Text>
      ) : null}
      {keyType === "trusted" ? <Switch testID="key-qr-invite" label={t("key.qrInvite")} value={qrInvite} onValueChange={setQrInvite} /> : null}
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
      <Disclosure testID="key-advanced" title={t("key.advanced")} open={advancedOpen} onToggle={setAdvancedOpen}>
        <Field
          testID="key-hours"
          label={t("key.hours")}
          help={`${t("key.advancedHelp")} ${t("key.hoursHelp")}`}
          error={errors.hours}
          value={shownHours}
          onChangeText={(value) => {
            setHours(value);
            // Strict keeps its trusted person; the hours are only its fallback wait.
            if (choice !== "strict") setChoice(value === "1" ? "mild" : value === "24" ? "firm" : "custom");
          }}
          keyboardType="number-pad"
          maxLength={2}
          autoComplete="off"
        />
      </Disclosure>
      {waitingForInvite && keyType === "trusted" && qrInvite ? (
        <VStack>
          <Button testID="key-share-invite" title={t("key.openInvite")} onPress={() => void shareInvite()} />
          <Text variant="small">{t("key.qrExpiredHint")}</Text>
        </VStack>
      ) : null}

      {/* Early unlock only ever applies to the delay key (D13). */}
      {offerSwitch ? (
        <Switch testID="key-early-unlock" label={t("early.switch")} help={t("early.switchHelpApp")} value={payUnlock} onValueChange={setPayUnlock} />
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
