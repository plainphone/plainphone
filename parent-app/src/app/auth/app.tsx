// SPDX-License-Identifier: Apache-2.0
//
// Opened by the login link in the mail (https://<server>/auth/app#token=…), which the
// app claims as a universal link (iOS) and app link (Android).
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { ApiError } from "../../api/client";
import { Button, errorMessage, Loading, Notice, PageTitle, Screen, Text } from "../../components/ui";
import { useI18n } from "../../i18n/I18n";
import { forgetLinkAsked, linkAskedHere } from "../../lib/link-asked";
import { matchesServerLink, tokenFromUrl } from "../../lib/links";
import { useSession } from "../../lib/session";

function currentUrl(linking: string | null): string | null {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.href;
  return linking;
}

export default function AuthLinkScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { state, verify, takeNext, serverUrl } = useSession();
  const linking = Linking.useLinkingURL();
  const [initial, setInitial] = useState<string | null | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // A link someone else sent would sign the app into their account. A link this app asked
  // for a moment ago is used straight away; any other link, or one opened while someone is
  // signed in, asks first (lib/link-asked.ts). Undefined while it is being looked up.
  const [askedHere, setAskedHere] = useState<boolean | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const running = useRef<string | null>(null);

  useEffect(() => {
    void Linking.getInitialURL().then((u) => setInitial(u ?? null));
    void linkAskedHere().then(setAskedHere);
  }, []);

  const fromUrl = [currentUrl(linking), initial]
    .filter((url) => matchesServerLink(url, serverUrl, "/auth/app"))
    .map(tokenFromUrl)
    .find(Boolean) ?? null;
  // The token is kept here once read, so the web build can drop it from the address bar and the
  // history at once, while "Log in with this link?" is still waiting for a tap.
  const [kept, setKept] = useState<string | null>(null);
  if (fromUrl && fromUrl !== kept) setKept(fromUrl);
  useEffect(() => {
    if (fromUrl && Platform.OS === "web") window.history.replaceState(null, "", window.location.pathname);
  }, [fromUrl]);
  const token = fromUrl ?? kept;

  // Still reading the launch URL while `initial` is undefined.
  const missing = initial !== undefined && !token;
  const error = failure ?? (missing ? t("callback.missing") : null);
  const ready = initial !== undefined && askedHere !== undefined && state.status !== "loading";
  // Decided once per token: the session turns "in" when the link has worked, and that is no reason to ask.
  const needsConfirm = !!token && started !== token && confirmed !== token && (!askedHere || state.status === "in");

  useEffect(() => {
    if (!ready || !token || needsConfirm || running.current === token) return;
    running.current = token;
    setStarted(token);
    if (Platform.OS === "web") window.history.replaceState(null, "", window.location.pathname);
    verify(token)
      .then((me) => {
        if (!me) return setFailure(t("error.generic"));
        void forgetLinkAsked();
        setDone(true);
      })
      .catch((err) => setFailure(err instanceof ApiError && err.status === 400 ? t("callback.failed") : errorMessage(err, t)));
    // Verify each token once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ready, needsConfirm]);

  useEffect(() => {
    if (!done) return;
    void takeNext().then((to) => {
      // Opened on top of the login screen (warm start): clear the stack so back never
      // returns to a login screen for someone who is signed in.
      if (router.canDismiss()) router.dismissAll();
      router.replace(to as never);
    });
  }, [done, takeNext, router]);

  if (ready && token && !error && needsConfirm) {
    return (
      <Screen testID="auth-link-confirm">
        <PageTitle>{t("callback.confirmTitle")}</PageTitle>
        <Text>{t("callback.confirmBody")}</Text>
        {state.status === "in" && <Text>{t("callback.signedInAs", { email: state.me.user.email })}</Text>}
        <Button testID="auth-link-confirm-yes" title={t("callback.confirm")} onPress={() => setConfirmed(token)} />
        <Button kind="secondary" title={t("app.cancel")} onPress={() => router.replace(state.status === "in" ? "/" : "/login")} />
      </Screen>
    );
  }

  return (
    <Screen testID="auth-link">
      <PageTitle>{t("callback.title")}</PageTitle>
      {error ? (
        <>
          <Notice tone="error" text={error} />
          <Button title={t("callback.toLogin")} onPress={() => router.replace("/login")} />
        </>
      ) : (
        <Loading />
      )}
    </Screen>
  );
}
