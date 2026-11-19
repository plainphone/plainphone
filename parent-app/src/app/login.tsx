// SPDX-License-Identifier: Apache-2.0
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, client, unwrap } from "../api/client";
import { ServerChoice } from "../components/ServerChoice";
import { Mark } from "../components/Mark";
import { Disclosure } from "../components/parts";
import { Button, errorMessage, Field, Loading, LiveStatus, Notice, PageTitle, Screen, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { SERVER_URL } from "../lib/config";
import { useSession } from "../lib/session";
import { space } from "../lib/theme";
import { EMAIL_RE } from "../lib/validate";

export { EMAIL_RE };

export default function LoginScreen() {
  const { t, locale } = useI18n();
  const { state, next, takeNext, serverUrl, serverChanging, changeServer } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [action, setAction] = useState<"login" | "switch" | null>(null);
  const pending = useRef(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [mail, setMail] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    unwrap<{ mail?: string }>(client.GET("/health"))
      .then((h) => { if (active && serverUrl === SERVER_URL) setMail(h?.mail ? h.mail !== "none" : null); })
      .catch(() => { if (active && serverUrl === SERVER_URL) setMail(null); });
    return () => { active = false; };
  }, [serverUrl]);

  const signedIn = state.status === "in";
  // Only while this screen is in front: a login link may have opened on top of it.
  useFocusEffect(
    useCallback(() => {
      if (signedIn) void takeNext().then((to) => router.replace(to as never));
    }, [signedIn, takeNext, router]),
  );
  if (signedIn) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  async function selectServer(value: string | null) {
    if (pending.current || serverChanging) return;
    pending.current = true;
    setAction("switch");
    try {
      const previous = SERVER_URL;
      await changeServer(value);
      if (previous !== SERVER_URL) {
        setSentTo(null);
        setMail(null);
        setFieldError(undefined);
        setFormError(null);
      }
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  async function submit() {
    if (pending.current || serverChanging) return;
    setFieldError(undefined);
    setFormError(null);
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setFieldError(t("login.invalidEmail"));
      return;
    }
    pending.current = true;
    setAction("login");
    try {
      const r = await unwrap<{ mailEnabled?: boolean } | undefined>(
        client.POST("/auth/request", { body: { email: value, locale, client: "native" } }),
      );
      if (r && typeof r.mailEnabled === "boolean") setMail(r.mailEnabled);
      setSentTo(r?.mailEnabled === false ? null : value);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields().email) setFieldError(t("login.invalidEmail"));
      else setFormError(errorMessage(err, t));
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  const pairing = next?.startsWith("/pair");
  const inviting = next?.startsWith("/invite");

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen testID="login">
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.lg }}>
          <Mark size={36} />
          <Text variant="heading">{t("app.name")}</Text>
        </View>
        <ServerChoice disabled={action === "login" || serverChanging} onSelect={selectServer} />
        {sentTo && mail !== false ? (
          <>
            <PageTitle>{t("login.sentTitle")}</PageTitle>
            <Text>{t("native.sentBody", { email: sentTo })}</Text>
            <Button kind="secondary" title={t("login.again")} onPress={() => setSentTo(null)} />
          </>
        ) : (
          <>
            <PageTitle sub={t("login.intro")}>{t("login.title")}</PageTitle>
            {pairing || inviting ? <Notice tone="info" text={t(inviting ? "login.inviteNote" : "login.pairNote")} /> : null}
            {mail === false ? (
              <>
                <Notice tone="warn" text={t("login.noMail")} />
                <Disclosure title={t("login.selfHost")}>
                  <Text>{t("login.selfHostHelp")}</Text>
                  <Link href="https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md">
                    {t("login.selfHostGuide")}
                  </Link>
                </Disclosure>
              </>
            ) : null}
            <Field
              testID="login-email"
              label={t("login.email")}
              error={fieldError}
              value={email}
              onChangeText={setEmail}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
            />
            <LiveStatus notice={formError ? { tone: "error", text: formError } : null} />
            <Button
              testID="login-submit"
              title={action === "login" ? t("login.sending") : t("login.submit")}
              busy={action === "login"}
              disabled={action === "switch" || serverChanging}
              onPress={() => void submit()}
            />
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}
