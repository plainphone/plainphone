// SPDX-License-Identifier: Apache-2.0
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, client, unwrap } from "../api/client";
import { ServerChoice } from "../components/ServerChoice";
import { Mark } from "../components/Mark";
import { Disclosure } from "../components/parts";
import { Button, errorMessage, Field, Loading, LiveStatus, Notice, PageTitle, Screen, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { SERVER_URL } from "../lib/config";
import { noteLinkAsked } from "../lib/link-asked";
import { BOT_CHALLENGE_CODES, BotCheckFailed, solveBotCheck } from "../lib/bot-check";
import { useSession } from "../lib/session";
import { space, touch, useColors } from "../lib/theme";
import { EMAIL_RE } from "../lib/validate";

export { EMAIL_RE };

const SELF_HOSTING_GUIDE = "https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md";

export default function LoginScreen() {
  const { t, locale } = useI18n();
  const colors = useColors();
  const { state, next, takeNext, serverUrl, serverChanging, changeServer, signInWithCode } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  // The store review address (docs/store-review.md) gets a code field instead of a mail.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [action, setAction] = useState<"login" | "switch" | null>(null);
  const pending = useRef(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  /** The hosted service has taken today's new households (SIGNUP_DAILY_CAP). */
  const [capped, setCapped] = useState(false);
  const [mail, setMail] = useState<boolean | null>(null);
  // The server asks for a solved bot check before it mails a link (docs/operations.md).
  const [botCheck, setBotCheck] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    unwrap<{ mail?: string; botChallenge?: string }>(client.GET("/health"))
      .then((h) => {
        if (!active || serverUrl !== SERVER_URL) return;
        setMail(h?.mail ? h.mail !== "none" : null);
        setBotCheck(h?.botChallenge === "altcha");
      })
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
        setCodeFor(null);
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
    setCapped(false);
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setFieldError(t("login.invalidEmail"));
      return;
    }
    pending.current = true;
    setAction("login");
    const ask = async (withCheck: boolean) => {
      let altcha: string | undefined;
      if (withCheck) {
        setChecking(true);
        try {
          altcha = await solveBotCheck();
        } catch (err) {
          // Offline stays the network message; anything else is a check that did not work.
          throw err instanceof ApiError && err.status === 0 ? err : new BotCheckFailed();
        } finally {
          setChecking(false);
        }
      }
      return unwrap<{ mailEnabled?: boolean; codeSignIn?: boolean } | undefined>(
        client.POST("/auth/request", { body: { email: value, locale, client: "native", ...(altcha ? { altcha } : {}) } }),
      );
    };
    try {
      // A server that turned the check on since /health was read says so: solve it and ask once more.
      const r = await ask(botCheck).catch((err: unknown) => {
        if (!botCheck && err instanceof ApiError && err.data.code === "bot_challenge_required") {
          setBotCheck(true);
          return ask(true);
        }
        throw err;
      });
      if (r?.codeSignIn) {
        setCode("");
        setCodeFor(value);
        return;
      }
      // The link this app asked for is used without a question (app/auth/app.tsx).
      await noteLinkAsked();
      if (r && typeof r.mailEnabled === "boolean") setMail(r.mailEnabled);
      setSentTo(r?.mailEnabled === false ? null : value);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fields().email) setFieldError(t("login.invalidEmail"));
      else if (err instanceof ApiError && err.data.code === "signup_cap_reached") setCapped(true);
      else if (err instanceof ApiError && err.data.code === "disposable_email") setFieldError(t("disposableEmail.error"));
      else if (err instanceof BotCheckFailed || (err instanceof ApiError && BOT_CHALLENGE_CODES.includes(String(err.data.code)))) {
        setFormError(t("botCheck.failed"));
      } else setFormError(errorMessage(err, t));
    } finally {
      pending.current = false;
      setAction(null);
    }
  }

  async function submitCode() {
    if (pending.current || serverChanging || !codeFor) return;
    setFieldError(undefined);
    setFormError(null);
    pending.current = true;
    setAction("login");
    try {
      // Signed in: the session turns "in" and the focus effect above moves on.
      await signInWithCode(codeFor, code.trim());
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 400)) setFieldError(t("login.codeWrong"));
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
        {codeFor ? (
          <>
            <PageTitle sub={t("login.codeIntro")}>{t("login.codeTitle")}</PageTitle>
            <Field
              testID="login-code"
              label={t("login.code")}
              error={fieldError}
              value={code}
              onChangeText={setCode}
              secureTextEntry
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => void submitCode()}
            />
            <LiveStatus notice={formError ? { tone: "error", text: formError } : null} />
            <Button
              testID="login-code-submit"
              title={action === "login" ? t("login.codeSending") : t("login.codeSubmit")}
              busy={action === "login"}
              disabled={action === "switch" || serverChanging}
              onPress={() => void submitCode()}
            />
            <Button kind="secondary" title={t("login.again")} onPress={() => { setCodeFor(null); setFieldError(undefined); }} />
          </>
        ) : sentTo && mail !== false ? (
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
                  <Pressable
                    onPress={() => void Linking.openURL(SELF_HOSTING_GUIDE).catch(() => undefined)}
                    accessibilityRole="link"
                    style={{ minHeight: touch, justifyContent: "center" }}
                  >
                    <Text style={{ color: colors.accent, textDecorationLine: "underline" }}>{t("login.selfHostGuide")}</Text>
                  </Pressable>
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
            {capped ? (
              <View testID="signup-capped">
                <Notice tone="info" text={t("signupCap.title")}>
                  <Text>{t("signupCap.body")}</Text>
                  <Text>{t("signupCap.selfHost")}</Text>
                  <Pressable
                    onPress={() => void Linking.openURL(SELF_HOSTING_GUIDE).catch(() => undefined)}
                    accessibilityRole="link"
                    style={{ minHeight: touch, justifyContent: "center" }}
                  >
                    <Text style={{ color: colors.accent, textDecorationLine: "underline" }}>{t("login.selfHostGuide")}</Text>
                  </Pressable>
                </Notice>
              </View>
            ) : null}
            <LiveStatus
              notice={formError ? { tone: "error", text: formError } : checking ? { tone: "info", text: t("botCheck.working") } : null}
            />
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
