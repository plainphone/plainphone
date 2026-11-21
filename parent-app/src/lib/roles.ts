// SPDX-License-Identifier: Apache-2.0
//
// Who this copy of the app is for (docs/ios/architecture.md, "App roles"). One app, three roles,
// like the Android phone app: Parent (the dashboard, what the app does today), Child (an iPhone
// managed with Family Controls) and Myself (an adult's own iPhone with the Self profile).
// Child is reachable only in an iPhone build made with PLAINPHONE_IOS_CHILD=1 (app.config.ts),
// which has the Swift module (parent-app/modules/plainphone-screentime). Every other build offers
// Parent only and behaves exactly as before.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getItem, setItem } from "./storage";

export const ROLES = ["parent", "child", "myself"] as const;
export type AppRole = (typeof ROLES)[number];

/** Which roles beyond Parent this build offers. Child from iOS phase 1, Myself later. */
export interface RoleFlags {
  child: boolean;
  myself: boolean;
}
export const ROLE_FLAGS: Readonly<RoleFlags> = Object.freeze({
  child: Platform.OS === "ios" && Constants.expoConfig?.extra?.iosChildRole === true,
  myself: false,
});

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

/** The role to use now, and whether the first-launch question is still unanswered. */
export async function loadRoleChoice(flags: RoleFlags = ROLE_FLAGS): Promise<{ role: AppRole; ask: boolean }> {
  const saved = await getItem(ROLE_KEY);
  return { role: resolveRole(saved, flags), ask: needsRoleChoice(saved, flags) };
}

export async function loadRole(flags: RoleFlags = ROLE_FLAGS): Promise<AppRole> {
  return resolveRole(await getItem(ROLE_KEY), flags);
}

export async function saveRole(role: AppRole, flags: RoleFlags = ROLE_FLAGS): Promise<AppRole> {
  const chosen = resolveRole(role, flags);
  await setItem(ROLE_KEY, chosen);
  return chosen;
}
