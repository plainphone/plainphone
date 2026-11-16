// SPDX-License-Identifier: Apache-2.0
//
// Opened by the login link in the mail (https://<server>/auth/app#token=…), which the
// app claims as a universal link (iOS) and app link (Android).
import * as Linking from "expo-linking";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ApiError } from "../../api/client";
import { Button, errorMessage, Loading, Notice, PageTitle, Screen } from "../../components/ui";
import { useI18n } from "../../i18n/I18n";
import { tokenFromUrl } from "../../lib/links";
import { useSession } from "../../lib/session";

function currentUrl(linking: string | null): string | null {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.href;
  return linking;
}

export default function AuthLinkScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { verify, next, setNext } = useSession();
  const linking = Linking.useLinkingURL();
  const [initial, setInitial] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void Linking.getInitialURL().then((u) => setInitial(u ?? null));
  }, []);

  const token = tokenFromUrl(currentUrl(linking)) ?? tokenFromUrl(initial);

  useEffect(() => {
    if (initial === undefined) return; // still reading the launch URL
    if (!token) {
      setError(t("callback.missing"));
      return;
    }
    if (Platform.OS === "web") window.history.replaceState(null, "", window.location.pathname);
    verify(token)
      .then((me) => (me ? setDone(true) : setError(t("error.generic"))))
      .catch((err) => setError(err instanceof ApiError && err.status === 400 ? t("callback.failed") : errorMessage(err, t)));
    // Verify each token once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initial]);

  if (done) {
    const to = next ?? "/";
    if (next) setNext(null);
    return <Redirect href={to as never} />;
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
