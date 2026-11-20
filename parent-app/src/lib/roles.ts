// SPDX-License-Identifier: Apache-2.0
//
// Who this copy of the app is for (docs/ios/architecture.md, "App roles"). One app, three roles,
// like the Android phone app: Parent (the dashboard, what the app does today), Child (an iPhone
// managed with Family Controls) and Myself (an adult's own iPhone with the Self profile).
// Only Parent is reachable until the iOS phases ship the native module; the flags below are
// the switch those phases turn on.
import { getItem, setItem } from "./storage";

export const ROLES = ["parent", "child", "myself"] as const;
export type AppRole = (typeof ROLES)[number];

/** Which roles beyond Parent this build offers. Off until iOS phase 1 (child) and later (myself). */
export interface RoleFlags {
  child: boolean;
  myself: boolean;
}
export const ROLE_FLAGS: Readonly<RoleFlags> = Object.freeze({ child: false, myself: false });

const ROLE_KEY = "pp.role";

/** Parent is always there: a parent must always be able to reach the dashboard. */
export function availableRoles(flags: RoleFlags = ROLE_FLAGS): AppRole[] {
  return ROLES.filter((role) => role === "parent" || flags[role]);
}

/** The saved role if this build offers it, otherwise Parent. Never a role the build has switched off. */
export function resolveRole(saved: string | null, flags: RoleFlags = ROLE_FLAGS): AppRole {
  return availableRoles(flags).find((role) => role === saved) ?? "parent";
}

/** Whether the first launch should ask whose phone this is. With one role there is nothing to ask. */
export function needsRoleChoice(saved: string | null, flags: RoleFlags = ROLE_FLAGS): boolean {
  return availableRoles(flags).length > 1 && resolveRole(saved, flags) !== saved;
}

export async function loadRole(flags: RoleFlags = ROLE_FLAGS): Promise<AppRole> {
  return resolveRole(await getItem(ROLE_KEY), flags);
}

export async function saveRole(role: AppRole, flags: RoleFlags = ROLE_FLAGS): Promise<AppRole> {
  const chosen = resolveRole(role, flags);
  await setItem(ROLE_KEY, chosen);
  return chosen;
}
