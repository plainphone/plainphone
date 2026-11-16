// SPDX-License-Identifier: Apache-2.0
import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, client, unwrap } from "../api/client";
import { Mark } from "../components/Mark";
import { Button, errorMessage, Field, LiveStatus, Notice, PageTitle, Screen, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { useSession } from "../lib/session";
import { space } from "../lib/theme";
import { EMAIL_RE } from "../lib/validate";

export { EMAIL_RE };

export default function LoginScreen() {
  const { t, locale } = useI18n();
  const { state, next, setNext } = useSession();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [mail, setMail] = useState<boolean | null>(null);

  useEffect(() => {
    unwrap<{ mail?: string }>(client.GET("/health"))
      .then((h) => setMail(h?.mail ? h.mail !== "none" : null))
      .catch(() => setMail(null));
  }, []);

  if (state.status === "in") {
    const to = next ?? "/";
    if (next) setNext(null);
    return <Redirect href={to as never} />;
  }

  async function submit() {
    setFieldError(undefined);
    setFormError(null);
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setFieldError(t("login.invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      const r = await unwrap<{ mailEnabled?: boolean } | undefined>(
        client.POST("/auth/request", { body: { email: value, locale, client: "native" } }),
      );
      if (r && typeof r.mailEnabled === "boolean") setMail(r.mailEnabled);
      setSentTo(value);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields().email) setFieldError(t("login.invalidEmail"));
      else setFormError(errorMessage(err, t));
    } finally {
      setBusy(false);
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
            {mail === false ? <Notice tone="warn" text={t("login.noMail")} /> : null}
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
              title={busy ? t("login.sending") : t("login.submit")}
              busy={busy}
              onPress={() => void submit()}
            />
          </>
        )}
      </Screen>
    </SafeAreaView>
  );
}
