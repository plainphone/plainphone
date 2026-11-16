// SPDX-License-Identifier: Apache-2.0
//
// Opened by the invitation link in the mail (https://<server>/invite#token=…). Not wrapped
// in RequireAuth: the token has to be read and kept before a logged-out parent is sent
// to log in, and after login this screen finds it again (lib/pendingInvite.ts).
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ApiError, client, unwrap } from "../api/client";
import { Button, errorMessage, Loading, Notice, PageTitle, Screen } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { clearPendingInvite, loadPendingInvite, savePendingInvite } from "../lib/pendingInvite";
import { useSession } from "../lib/session";
import { useLaunchToken } from "../lib/useLaunchToken";

// One accept per token, also when effects run twice in development or the screen is opened
// again after it worked. A failed accept is forgotten, so the link can be tried again.
const inflight = new Map<string, Promise<unknown>>();

export default function InviteScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { state, refresh, setNext } = useSession();
  const { token: linkToken, ready } = useLaunchToken();
  // The token kept from before the login. undefined: not looked up yet; null: none.
  const [kept, setKept] = useState<string | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<{ token: string; result: "ok" | string } | null>(null);

  // The token is in the link, or was kept from before the login.
  const token = linkToken ?? kept ?? null;
  const looking = !ready || (!linkToken && kept === undefined);

  useEffect(() => {
    if (!ready) return;
    if (linkToken) {
      void savePendingInvite(linkToken);
      return;
    }
    let cancelled = false;
    void loadPendingInvite().then((saved) => {
      if (!cancelled) setKept(saved);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, linkToken]);

  const anon = state.status === "anon";
  useEffect(() => {
    if (anon && token) setNext("/invite");
  }, [anon, token, setNext]);

  useEffect(() => {
    if (!token || state.status !== "in") return;
    let p = inflight.get(token);
    if (!p) {
      p = unwrap(client.POST("/invites/accept", { body: { token } }));
      inflight.set(token, p);
      p.catch(() => inflight.delete(token));
    }
    p.then(
      () => {
        setOutcome({ token, result: "ok" });
        void refresh();
      },
      (err) => setOutcome({ token, result: err instanceof ApiError && err.status === 400 ? t("invite.failed") : errorMessage(err, t) }),
    ).finally(() => {
      void clearPendingInvite();
      if (Platform.OS === "web") window.history.replaceState(null, "", window.location.pathname);
    });
    // Accept each token once; a changed language or a refreshed session must not run it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, state.status]);

  if (state.status === "loading" || looking) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (token && anon) return <Redirect href="/login" />;

  const result = outcome?.token === token ? outcome.result : null;
  return (
    <Screen testID="invite">
      <PageTitle>{t("invite.title")}</PageTitle>
      {!token ? (
        <Notice tone="error" text={t("invite.missing")} />
      ) : result === null ? (
        <Notice tone="info" text={t("invite.accepting")} />
      ) : result === "ok" ? (
        <>
          <Notice tone="success" text={t("invite.accepted")} />
          <Button testID="invite-done" title={t("invite.toPhones")} onPress={() => router.replace("/")} />
        </>
      ) : (
        <Notice tone="error" text={result} />
      )}
    </Screen>
  );
}
