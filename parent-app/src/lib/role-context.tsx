// SPDX-License-Identifier: Apache-2.0
//
// The app's role for this launch (src/lib/roles.ts) and the routing that follows from it. In a
// build that offers only Parent this does nothing at all. With Child on: a first launch without a
// signed-in parent asks "Whose phone is this?", a child's iPhone opens on /child, and a parent who
// was already signed in keeps the dashboard without being asked.
import { useRouter, useSegments } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type AppRole, availableRoles, loadRoleChoice, ROLE_FLAGS, type RoleFlags, saveRole } from "./roles";
import { useSession } from "./session";

interface RoleValue {
  /** Null while the saved role loads. */
  role: AppRole | null;
  ask: boolean;
  /** The roles this build offers on this iPhone (roles.ts: Child only on iOS 26 or later). */
  offered: readonly AppRole[];
  choose(role: AppRole): Promise<void>;
}

const RoleContext = createContext<RoleValue>({ role: "parent", ask: false, offered: ["parent"], choose: async () => {} });

export function RoleProvider({ children, flags = ROLE_FLAGS }: { children: ReactNode; flags?: RoleFlags }) {
  const offered = useMemo(() => availableRoles(flags), [flags]);
  const multi = offered.length > 1;
  const [state, setState] = useState<{ role: AppRole | null; ask: boolean }>({ role: multi ? null : "parent", ask: false });
  useEffect(() => {
    if (multi) void loadRoleChoice(flags).then(setState);
  }, [multi, flags]);
  const choose = useCallback(async (role: AppRole) => {
    setState({ role: await saveRole(role, flags), ask: false });
  }, [flags]);
  const value = useMemo(() => ({ ...state, offered, choose }), [state, offered, choose]);
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleValue {
  return useContext(RoleContext);
}

/** Sends the app where its role belongs. Call once, inside the router. */
export function useRoleRouting() {
  const { role, ask, choose } = useRole();
  const { state } = useSession();
  const router = useRouter();
  const top = useSegments()[0] as string | undefined;
  useEffect(() => {
    if (role === null || state.status === "loading") return;
    if (ask) {
      // Someone already signed in as a parent on this iPhone: no question, nothing changes.
      if (state.status === "in") void choose("parent");
      else if (top !== "role") router.replace("/role");
      return;
    }
    if (role === "child" && top !== "child") router.replace("/child");
  }, [role, ask, state.status, top, router, choose]);
}
