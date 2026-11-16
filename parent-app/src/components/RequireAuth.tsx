// SPDX-License-Identifier: Apache-2.0
import { Redirect, usePathname, useGlobalSearchParams } from "expo-router";
import { type ReactNode, useEffect } from "react";
import { useSession } from "../lib/session";
import { Loading, Screen } from "./ui";

/** Shows the screen when signed in; otherwise remembers where the user was going and sends them to log in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, setNext } = useSession();
  const path = usePathname();
  const params = useGlobalSearchParams<{ code?: string }>();
  const anon = state.status === "anon";
  useEffect(() => {
    // Only a pairing link is worth coming back to after logging in; a screen the user was
    // on when signed out (logout, an expired session) is not.
    if (anon && path === "/pair" && params.code) setNext(`/pair?code=${encodeURIComponent(params.code)}`);
  }, [anon, path, params.code, setNext]);
  if (state.status === "loading") {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (anon) return <Redirect href="/login" />;
  return <>{children}</>;
}
