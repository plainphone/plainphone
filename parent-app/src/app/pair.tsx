// SPDX-License-Identifier: Apache-2.0
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ApiError, client, unwrap } from "../api/client";
import type { Phone, Profile } from "../api/models";
import { RequireAuth } from "../components/RequireAuth";
import { ScanCode } from "../components/ScanCode";
import { Button, Choice, errorMessage, Field, LiveStatus, type NoticeValue, PageTitle, Screen, Stack, Switch, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { normaliseCode } from "../shared/lib/format";

function PairForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(() => normaliseCode(params.code ?? ""));
  const [name, setName] = useState("");
  const [profile, setProfile] = useState<Profile>("child");
  const [privateDns, setPrivateDns] = useState(false);
  const [lookup, setLookup] = useState<{ code: string; profile?: Profile; light?: boolean; done: boolean }>({ code, done: false });
  const [awaitingPhone, setAwaitingPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ code?: string; name?: string }>({});
  const [notice, setNotice] = useState<NoticeValue | null>(null);

  // A pairing link opened while this screen is already showing fills in its code.
  const [seenParam, setSeenParam] = useState(params.code);
  if (params.code !== seenParam) {
    setSeenParam(params.code);
    if (params.code) setCode(normaliseCode(params.code));
  }

  const codeComplete = code.replace(/-/g, "").length === 8;
  if (lookup.code !== code) setLookup({ code, done: false });
  const hint = lookup.code === code ? lookup.profile : undefined;
  const lookupPending = codeComplete && (lookup.code !== code || !lookup.done);

  useEffect(() => {
    if (!codeComplete) return;
    let current = true;
    async function lookupProfile() {
      let found: Profile | undefined;
      let light = false;
      try {
        const { data } = await client.POST("/phones/pairing-profile", { body: { code } });
        found = data?.profile ?? undefined;
        light = data?.mode === "light";
      } catch {
        // The claim endpoint checks the profile again.
      }
      if (!current) return;
      if (found) setProfile(found);
      setLookup({ code, profile: found, light, done: true });
    }
    void lookupProfile();
    return () => { current = false; };
  }, [code, codeComplete]);

  async function submit() {
    setNotice(null);
    const next: typeof errors = {};
    if (!codeComplete) next.code = t("pair.codeInvalid");
    if (!name.trim()) next.name = t("pair.nameRequired");
    setErrors(next);
    if (next.code || next.name) return;
    setBusy(true);
    try {
      let timezone: string | undefined;
      try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        timezone = undefined;
      }
      const phone = await unwrap<Phone>(client.POST("/phones/claim", { body: { code, name: name.trim(), profile, timezone, ...(lookup.light && profile === "self" && privateDns ? { filterMethod: "privateDns" as const } : {}) } }));
      if (phone.pairedAt === null) setAwaitingPhone(true);
      else router.replace({ pathname: "/phones/[pid]", params: { pid: phone.id } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setNotice({ tone: "error", text: t("pair.profileMismatch") });
      else if (err instanceof ApiError && err.status === 404) setErrors({ code: t("pair.codeNotFound") });
      else if (err instanceof ApiError && err.status === 400 && err.issues.length) {
        const f = err.fields();
        setErrors({ code: f.code ? t("pair.codeInvalid") : undefined, name: f.name ? t("pair.nameRequired") : undefined });
        setNotice({ tone: "error", text: t("error.form") });
      } else setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  if (awaitingPhone) return (
    <Screen testID="pair">
      <PageTitle>{t("pair.title")}</PageTitle>
      <LiveStatus notice={{ tone: "success", text: t("pair.confirmOnPhone") }} />
      <Button title={t("nav.phones")} onPress={() => router.replace("/")} />
    </Screen>
  );

  const canScan = Platform.OS !== "web";
  return (
    <Screen testID="pair">
      <PageTitle sub={t("pair.intro")}>{t("pair.title")}</PageTitle>
      {canScan ? (
        <ScanCode
          onStatus={setNotice}
          onCode={(scanned) => {
            const shown = normaliseCode(scanned);
            setCode(shown);
            setErrors((e) => ({ ...e, code: undefined }));
            setNotice({ tone: "success", text: t("native.scanned", { code: shown }) });
          }}
        />
      ) : null}
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <Stack>
        {canScan ? <Text variant="muted">{t("native.typeCode")}</Text> : null}
        <Field
          testID="pair-code"
          label={t("pair.code")}
          help={t("pair.codeHelp")}
          error={errors.code}
          value={code}
          onChangeText={(v) => setCode(normaliseCode(v))}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect={false}
          spellCheck={false}
          maxLength={9}
          placeholder="K7MP-4QXR"
          style={{ fontFamily: "monospace", letterSpacing: 1 }}
        />
        <Field
          testID="pair-name"
          label={t("pair.name")}
          help={t("pair.nameHelp")}
          error={errors.name}
          value={name}
          onChangeText={setName}
          maxLength={40}
          autoComplete="off"
          returnKeyType="done"
        />
        <Choice<Profile>
          label={t("pair.profile")}
          hint={hint ? t("pair.profileFromPhone") : undefined}
          disabled={hint !== undefined}
          value={profile}
          onChange={setProfile}
          options={[
            { value: "child", label: t("profile.child"), help: t("profile.childHelp") },
            { value: "self", label: t("profile.self"), help: t("profile.selfHelp") },
          ]}
        />
      </Stack>
      <Button kind="secondary" title={t("phoneLanguage.strong")} onPress={() => router.push("/strong-setup")} />
      {lookup.light && profile === "self" ? (
        <Switch label={t("filter.otherVpn")} value={privateDns} onValueChange={setPrivateDns}
          help={privateDns ? t("filter.tailscaleTip") : t("filter.methodHelp")} />
      ) : null}
      <Button testID="pair-submit" title={busy ? t("pair.adding") : t("pair.submit")} busy={busy} disabled={lookupPending} onPress={() => void submit()} />
    </Screen>
  );
}

export default function PairScreen() {
  return (
    <RequireAuth>
      <PairForm />
    </RequireAuth>
  );
}
