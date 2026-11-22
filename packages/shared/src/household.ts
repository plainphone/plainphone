// SPDX-License-Identifier: Apache-2.0
// Which household a parent is looking at when they are in more than one. Platform-free: the
// PWA keeps the choice in localStorage and the parent app in its own storage.

/** The household for `savedId` if the parent is still in it, otherwise the first one (like `GET /me`). */
export function pickHousehold<T extends { id: string }>(households: readonly T[], savedId: string | null | undefined): T | undefined {
  return households.find((h) => h.id === savedId) ?? households[0];
}

/** The picker's option text: the household's name and the parent's role in it, so two "Home" differ. */
export function householdOptionLabel(name: string, roleLabel: string): string {
  return `${name} (${roleLabel})`;
}
