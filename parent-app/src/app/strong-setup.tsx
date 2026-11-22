// SPDX-License-Identifier: Apache-2.0
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking } from "react-native";
import { client, unwrap } from "../api/client";
import type { Phone, Profile } from "../api/models";
import { AgePicker, AgreementFields, type AgreementDraft, agreementProblems, ReviewPicker } from "../components/AgeControls";
import { PhoneLanguagePicker } from "../components/PhoneLanguagePicker";
import { RequireAuth } from "../components/RequireAuth";
import { useActiveHousehold } from "../lib/session";
import { Button, Choice, errorMessage, Field, LiveStatus, LoadGate, type NoticeValue, PageTitle, Screen, Stack, Text, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { SERVER_URL } from "../lib/config";
import { DEFAULT_AGE_CHOICES, saveSetupChoices, type AgeChoices } from "../lib/setup-choices";
import { type AgePreset, parseLines } from "@plainphone/shared/age";
import type { PhoneLanguage } from "@plainphone/i18n/phone-language";

type Stage = "who" | "age" | "agreement";

function StrongSetup() {
  const { t } = useI18n();
  // The household the app shows; without it the server picks any of the parent's households.
  const householdId = useActiveHousehold()?.id;
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("who");
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>("child");
  const [language, setLanguage] = useState<PhoneLanguage>(null);
  const [age, setAge] = useState<AgeChoices>(DEFAULT_AGE_CHOICES);
  const [agreement, setAgreement] = useState<AgreementDraft>({ lines: "", adultLines: "" });
  const [phoneId, setPhoneId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const presets = useLoad(async () => (await unwrap<{ presets: AgePreset[] }>(client.GET("/age-presets"))).presets, []);

  function next() {
    if (!name.trim()) {
      setError(t("pair.nameRequired"));
      return;
    }
    // A Child phone has two optional steps before the browser: where the rules start, and the agreement.
    if (profile === "child" && !phoneId) setStage("age");
    else void continueSetup();
  }

  async function continueSetup(skipAgreement = false) {
    setBusy(true);
    setNotice(null);
    try {
      let id = phoneId;
      if (!id) {
        const { phone } = await unwrap<{ phone: Phone }>(client.POST("/phones/enroll", {
          body: { mode: "strong", name: name.trim(), profile, language, householdId },
        }));
        id = phone.id;
        setPhoneId(id);
        // The phone exists now: what was chosen on the way is saved on it. A failure here never loses the setup.
        if (profile === "child" && await saveSetupChoices(id, age, skipAgreement ? { lines: "", adultLines: "" } : agreement)) {
          setNotice({ tone: "warn", text: t("age.setupSaveFailed") });
        }
      }
      // Reopening the browser after an error reuses the phone that was already saved.
      await Linking.openURL(`${SERVER_URL}/phones/${id}/setup`);
      router.replace({ pathname: "/phones/[pid]", params: { pid: id } });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  if (stage === "age") {
    return (
      <Screen testID="setup-age">
        <PageTitle sub={t("age.setupIntro")}>{t("age.setupTitle", { name: name.trim() })}</PageTitle>
        <Stack>
          <LoadGate res={presets}>
            {(list) => <AgePicker presets={list} value={age.preset} onChange={(preset) => setAge({ ...age, preset })} />}
          </LoadGate>
          <ReviewPicker enabled={age.review} months={age.months} onEnabled={(review) => setAge({ ...age, review })} onMonths={(months) => setAge({ ...age, months })} />
          <Button testID="setup-age-next" title={t("age.continue")} onPress={() => setStage("agreement")} />
          <Button kind="secondary" title={t("app.back")} onPress={() => setStage("who")} />
        </Stack>
      </Screen>
    );
  }

  if (stage === "agreement") {
    const problems = agreementProblems(agreement);
    const empty = parseLines(agreement.lines).length === 0 && parseLines(agreement.adultLines).length === 0;
    return (
      <Screen testID="setup-agreement">
        <PageTitle sub={t("age.agreement.intro")}>{t("age.agreement.title")}</PageTitle>
        <Stack>
          <Text variant="small">{t("age.agreement.optional")}</Text>
          <AgreementFields draft={agreement} onChange={setAgreement} disabled={busy} />
          <LiveStatus notice={notice} />
          <Button
            testID="setup-agreement-next"
            title={t("phoneLanguage.browser")}
            busy={busy}
            disabled={problems.lines !== null || problems.adultLines !== null}
            onPress={() => void continueSetup()}
          />
          {!empty ? (
            <Button kind="secondary" title={t("age.skip")} disabled={busy} onPress={() => { setAgreement({ lines: "", adultLines: "" }); void continueSetup(true); }} />
          ) : null}
          <Button kind="secondary" title={t("app.back")} disabled={busy} onPress={() => setStage("age")} />
        </Stack>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageTitle sub={t("phoneLanguage.browserHelp")}>{t("phoneLanguage.strong")}</PageTitle>
      <Stack>
        <Field label={t("pair.name")} value={name} error={error} maxLength={40} editable={!busy && !phoneId} onChangeText={(value) => {
          setName(value);
          setError(undefined);
        }} />
        <Choice
          label={t("pair.profile")}
          value={profile}
          onChange={setProfile}
          disabled={busy || !!phoneId}
          options={[
            { value: "child", label: t("profile.child"), help: t("profile.childHelp") },
            { value: "self", label: t("profile.self"), help: t("profile.selfHelp") },
          ]}
        />
        <PhoneLanguagePicker value={language} onChange={setLanguage} setup={profile === "child"} disabled={busy || !!phoneId} />
        <LiveStatus notice={notice} />
        <Button title={t(profile === "child" && !phoneId ? "age.continue" : "phoneLanguage.browser")} busy={busy} onPress={next} />
      </Stack>
    </Screen>
  );
}

export default function StrongSetupScreen() {
  return <RequireAuth><StrongSetup /></RequireAuth>;
}
