// SPDX-License-Identifier: Apache-2.0

export const SETUP_UNDO_WINDOW_MS = 48 * 60 * 60_000;
export const PAIRING_RECOVERY_MS = 24 * 60 * 60_000;

export function maskPairingEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return `${Array.from(email.slice(0, at))[0]}***@${email.slice(at + 1)}`;
}

export function pairingAccount(
  claimedBy: string | null,
  account: { id: string; email: string } | undefined,
  householdName: string | null,
) {
  if (!claimedBy || account?.id !== claimedBy) return null;
  const maskedEmail = maskPairingEmail(account.email);
  if (!maskedEmail) return null;
  // A household can be given an arbitrary name, including the user's login address.
  const safeName = householdName?.toLowerCase().includes(account.email.toLowerCase()) ? null : householdName;
  return { maskedEmail, householdName: safeName };
}
