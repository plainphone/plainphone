// SPDX-License-Identifier: Apache-2.0
//
// Opened by the invitation link in the mail (https://<server>/invite#token=…). Not wrapped
// in RequireAuth: the token has to be read and kept before a logged-out parent is sent
// to log in, and after login this screen finds it again (lib/pendingInvite.ts).
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ApiError, client, unwrap } from "../api/client";
import { Button, errorMessage, Loading, Notice, PageTitle, Screen, Text } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { acceptedInvites, clearPendingInvite, loadPendingInvite, savePendingInvite } from "../lib/pendingInvite";
import { useSession } from "../lib/session";
import { useLaunchToken } from "../lib/useLaunchToken";

// One accept per token, also when effects run twice in development or the screen is opened
// again after it worked. A failed accept is forgotten, so the link can be tried again.
const inflight = acceptedInvites;

export default function InviteScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { state, refresh, setNext, serverUrl, logout } = useSession();
  const { token: linkToken, ready } = useLaunchToken(serverUrl);
  // The token kept from before the login. undefined: not looked up yet; null: none.
  const [kept, setKept] = useState<string | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<{ token: string; result: "ok" | string } | null>(null);
  // The invitation was sent to another address than the signed-in one; the link is kept.
  const [otherAddress, setOtherAddress] = useState<string | null>(null);

  // The token is in the link, or was kept from before the login.
  const token = linkToken ?? kept ?? null;
  const trusted = token?.startsWith("pp_t_") ?? false;
  const [confirmed, setConfirmed] = useState(false);
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
    // Every invitation waits for a tap: a link from a stranger must not add this parent to their household.
    if (!token || state.status !== "in" || !confirmed || otherAddress === token) return;
    let p = inflight.get(token);
    if (!p) {
      p = unwrap(client.POST("/invites/accept", { body: { token } }));
      inflight.set(token, p);
      p.catch(() => inflight.delete(token));
    }
    const done = () => {
      void clearPendingInvite();
      if (Platform.OS === "web") window.history.replaceState(null, "", window.location.pathname);
    };
    p.then(
      () => {
        setOutcome({ token, result: "ok" });
        void refresh();
        done();
      },
      (err) => {
        if (err instanceof ApiError && err.status === 403 && err.data.code === "invite_email_mismatch") {
          // Keep the link: it works for the invited address, after a sign-out.
          setOtherAddress(token);
          return;
        }
        setOutcome({ token, result: err instanceof ApiError && err.status === 400 ? t("invite.failed") : errorMessage(err, t) });
        done();
      },
    );
    // Accept each token once; a changed language or a refreshed session must not run it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, state.status, trusted, confirmed, otherAddress]);

  const signOutAndContinue = async () => {
    if (!token) return;
    // logout() signs out locally even when the server cannot be reached, so it does not throw.
    await logout();
    // Signing out forgets the invitation so the next person does not inherit it; this one is kept on purpose.
    await savePendingInvite(token);
    setNext("/invite");
  };

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
      ) : !confirmed ? (
        <>
          <Text>{t(trusted ? "invite.trustedHelp" : "invite.householdHelp")}</Text>
          <Button testID="invite-accept" title={t(trusted ? "invite.trustedAccept" : "invite.householdAccept")} onPress={() => setConfirmed(true)} />
          <Button
            kind="secondary"
            title={t("app.cancel")}
            onPress={() => {
              void clearPendingInvite();
              router.replace("/");
            }}
          />
        </>
      ) : otherAddress === token ? (
        <>
          <Notice tone="error" text={t("invite.otherAddress")} />
          <Button testID="invite-signout" title={t("invite.signOutContinue")} onPress={() => void signOutAndContinue()} />
          <Button
            kind="secondary"
            title={t("app.cancel")}
            onPress={() => {
              void clearPendingInvite();
              router.replace("/");
            }}
          />
        </>
      ) : result === null ? (
        <Notice tone="info" text={t("invite.accepting")} />
      ) : result === "ok" ? (
        <>
          <Notice tone="success" text={t(trusted ? "invite.trustedAccepted" : "invite.accepted")} />
          <Button testID="invite-done" title={t(trusted ? "appr.title" : "invite.toPhones")} onPress={() => router.replace(trusted ? "/approvals" : "/")} />
        </>
      ) : (
        <Notice tone="error" text={result} />
      )}
    </Screen>
  );
}
