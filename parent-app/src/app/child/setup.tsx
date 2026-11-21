// SPDX-License-Identifier: Apache-2.0
//
// The guided setup on a child's iPhone (docs/ios/architecture.md, phase 1): welcome, Screen Time
// permission, pairing by QR code, the Apple settings Plainphone cannot set itself, done. One task
// per screen; the step comes from src/lib/iphone/wizard.ts, so a closed app resumes in place.
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useReducer, useState } from "react";
import { nativeScreenTime } from "../../../modules/plainphone-screentime";
import { QrCode } from "../../components/QrCode";
import { Button, Loading, Notice, PageTitle, Screen, Stack, Text, useLoad } from "../../components/ui";
import { useI18n } from "../../i18n/I18n";
import { SERVER_URL } from "../../lib/config";
import { deviceFetch, loadIdentity, saveIdentity } from "../../lib/iphone/device-api";
import { pairingReducer, POLL_MS, pollPairing, startPairing } from "../../lib/iphone/pairing";
import { answerAppleSettings, currentStep, loadWizardFlags, markStarted, progress, type WizardFacts, type WizardStep } from "../../lib/iphone/wizard";
import { useRole } from "../../lib/role-context";
import { formatTimeOfDay } from "../../shared/lib/format";

export default function ChildSetupScreen() {
  const { role } = useRole();
  if (role === null) return <Screen><Loading /></Screen>;
  if (role !== "child") return <Redirect href="/" />;
  return <ChildSetup />;
}

async function loadFacts(): Promise<WizardFacts> {
  const [flags, identity, authorization] = await Promise.all([
    loadWizardFlags(),
    loadIdentity(),
    nativeScreenTime().authorizationStatus().catch(() => "unavailable"),
  ]);
  return { ...flags, paired: identity !== null, authorization };
}

function ChildSetup() {
  const router = useRouter();
  const { data: facts, reloadQuiet } = useLoad(loadFacts, []);
  const next = useCallback(() => void reloadQuiet(), [reloadQuiet]);
  if (!facts) return <Screen><Loading /></Screen>;
  const step = currentStep(facts);
  return (
    <Screen testID={`setup-${step}`}>
      <StepTitle step={step} />
      {step === "welcome" ? <Welcome onStart={() => void markStarted().then(next)} /> : null}
      {step === "permission" ? <Permission authorization={facts.authorization} onAnswer={next} /> : null}
      {step === "pair" ? <Pair onPaired={next} /> : null}
      {step === "appleSettings" ? <AppleSettings onAnswer={(a) => void answerAppleSettings(a).then(next)} /> : null}
      {step === "done" ? <Done onOk={() => router.replace("/child")} /> : null}
    </Screen>
  );
}

const TITLES: Record<WizardStep, Parameters<ReturnType<typeof useI18n>["t"]>[0]> = {
  welcome: "iphone.setup.title",
  permission: "iphone.permission.title",
  pair: "iphone.pair.title",
  appleSettings: "iphone.apple.title",
  done: "iphone.done.title",
};

function StepTitle({ step }: { step: WizardStep }) {
  const { t } = useI18n();
  const p = progress(step);
  return <PageTitle sub={p ? t("iphone.setup.step", { n: p.index, total: p.total }) : undefined}>{t(TITLES[step])}</PageTitle>;
}

function Welcome({ onStart }: { onStart: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { choose } = useRole();
  return (
    <Stack>
      <Text>{t("iphone.welcome.body")}</Text>
      <Button testID="setup-start" title={t("iphone.welcome.start")} onPress={onStart} />
      <Button
        testID="setup-not-child"
        kind="plain"
        title={t("iphone.welcome.notChild")}
        onPress={() => void choose("parent").then(() => router.replace("/login"))}
      />
    </Stack>
  );
}

function Permission({ authorization, onAnswer }: { authorization: string; onAnswer: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (authorization === "unavailable") return <Notice tone="warn" text={t("iphone.permission.unavailable")} />;
  return (
    <Stack>
      <Text>{t("iphone.permission.body")}</Text>
      {authorization === "denied" ? <Notice tone="warn" text={t("iphone.permission.denied")} /> : null}
      <Button
        testID="setup-allow"
        title={t("iphone.permission.ask")}
        busy={busy}
        onPress={() => {
          setBusy(true);
          // iOS shows its own sheet; a refusal throws, and the step then says what to check.
          void nativeScreenTime().requestAuthorization("child").catch(() => null).finally(() => {
            setBusy(false);
            onAnswer();
          });
        }}
      />
    </Stack>
  );
}

function Pair({ onPaired }: { onPaired: () => void }) {
  const { t, locale } = useI18n();
  const [state, dispatch] = useReducer(pairingReducer, { step: "idle" });
  const api = deviceFetch(SERVER_URL);

  useEffect(() => {
    if (state.step === "idle") dispatch({ type: "start" });
    if (state.step === "starting") void startPairing(api, { model: "iPhone" }).then(dispatch);
    if (state.step !== "showing") return;
    const timer = setTimeout(() => void pollPairing(api, state, new Date()).then(dispatch), POLL_MS);
    return () => clearTimeout(timer);
    // `api` is rebuilt each render from SERVER_URL; the state alone decides what to do next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (state.step !== "paired") return;
    const { phoneId, deviceToken } = state;
    // Forget a receipt from an earlier pairing (a release), then keep the token.
    void nativeScreenTime().beginNewPairing().catch(() => null)
      .then(() => saveIdentity({ phoneId, deviceToken, server: SERVER_URL }))
      .then(onPaired);
  }, [state, onPaired]);

  if (state.step === "showing") {
    return (
      <Stack>
        <Text>{t("iphone.pair.body")}</Text>
        <QrCode testID="setup-qr" value={state.qrUrl} label={t("iphone.pair.qrLabel", { code: state.code })} />
        <Text variant="mono" testID="setup-code">{t("iphone.pair.code", { code: state.code })}</Text>
        <Text variant="small">{t("iphone.pair.expires", { time: formatTimeOfDay(state.expiresAt, locale) })}</Text>
        <Text variant="muted" accessibilityLiveRegion="polite">{t("iphone.pair.waiting")}</Text>
      </Stack>
    );
  }
  if (state.step === "notYet") return <Notice tone="info" text={t("iphone.pair.notYet")} />;
  if (state.step === "expired" || state.step === "failed") {
    return (
      <Stack>
        <Notice tone={state.step === "failed" ? "error" : "info"} text={t(state.step === "failed" ? "iphone.pair.failed" : "iphone.pair.expired")} />
        <Button
          testID="setup-new-code"
          title={t(state.step === "failed" ? "iphone.pair.retry" : "iphone.pair.newCode")}
          onPress={() => dispatch({ type: "start" })}
        />
      </Stack>
    );
  }
  return <Loading />;
}

function AppleSettings({ onAnswer }: { onAnswer: (answer: "done" | "later") => void }) {
  const { t } = useI18n();
  return (
    <Stack>
      <Text>{t("iphone.apple.body")}</Text>
      <Text>{`1. ${t("iphone.apple.step1")}`}</Text>
      <Text>{`2. ${t("iphone.apple.step2")}`}</Text>
      <Text>{`3. ${t("iphone.apple.step3")}`}</Text>
      {/* TODO(spike e, docs/ios/spikes.md): confirm Communication Limits through Declared Age Range. */}
      <Text variant="small">{t("iphone.apple.note")}</Text>
      <Button testID="setup-apple-done" title={t("iphone.apple.done")} onPress={() => onAnswer("done")} />
      <Button testID="setup-apple-later" kind="secondary" title={t("iphone.apple.later")} onPress={() => onAnswer("later")} />
    </Stack>
  );
}

function Done({ onOk }: { onOk: () => void }) {
  const { t } = useI18n();
  return (
    <Stack>
      <Text>{t("iphone.done.body")}</Text>
      <Button testID="setup-finish" title={t("iphone.done.ok")} onPress={onOk} />
    </Stack>
  );
}
