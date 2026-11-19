// SPDX-License-Identifier: Apache-2.0
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking } from "react-native";
import { client, unwrap } from "../api/client";
import type { Phone, Profile } from "../api/models";
import { PhoneLanguagePicker } from "../components/PhoneLanguagePicker";
import { RequireAuth } from "../components/RequireAuth";
import { Button, Choice, errorMessage, Field, LiveStatus, type NoticeValue, PageTitle, Screen, Stack } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { SERVER_URL } from "../lib/config";
import type { PhoneLanguage } from "../shared/lib/phone-language";

function StrongSetup() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>("child");
  const [language, setLanguage] = useState<PhoneLanguage>(null);
  const [phoneId, setPhoneId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<NoticeValue | null>(null);

  async function continueSetup() {
    if (!name.trim()) {
      setError(t("pair.nameRequired"));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      let id = phoneId;
      if (!id) {
        const { phone } = await unwrap<{ phone: Phone }>(client.POST("/phones/enroll", {
          body: { mode: "strong", name: name.trim(), profile, language },
        }));
        id = phone.id;
        setPhoneId(id);
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
        <Button title={t("phoneLanguage.browser")} busy={busy} onPress={() => void continueSetup()} />
      </Stack>
    </Screen>
  );
}

export default function StrongSetupScreen() {
  return <RequireAuth><StrongSetup /></RequireAuth>;
}
