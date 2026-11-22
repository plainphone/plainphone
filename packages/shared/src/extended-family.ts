// SPDX-License-Identifier: Apache-2.0
//
// Extended family contacts and location snapshots (docs/extended-family.md). Platform-free, shared by
// the web dashboard and the parent app.

import type { MessageKey } from "@plainphone/i18n/en";

export type ContactGroupId = "family" | "friends" | "others";
export type ExtendedStatus =
  | "waitingForChild"
  | "waitingForContact"
  | "active"
  | "blocked"
  | "declinedByChild"
  | "declinedByContact"
  | "expired";

export interface LocationSnapshot {
  lat: number;
  lon: number;
  accuracyM: number | null;
  recordedAt: string;
  expiresAt: string;
}

export interface ExtendedContact {
  id: string;
  name: string;
  group: ContactGroupId;
  status: ExtendedStatus;
  childApproved: boolean;
  contactAccepted: boolean;
  linkExpiresAt: string | null;
  createdAt: string;
}

export interface ExtendedRoster {
  enabled: boolean;
  locationSnapshots: boolean;
  contacts: ExtendedContact[];
}

export interface ExtendedInvite {
  contact: ExtendedContact;
  /** The single-use link. Shown once; the server keeps only its hash. */
  link: string;
  expiresAt: string;
}

/** The longest name a parent can give a person, and the longest short reply. */
export const EXTENDED_NAME_LENGTH = 40;
export const EXTENDED_REPLY_LENGTH = 60;

export const STATE_KEYS: Record<ExtendedStatus, MessageKey> = {
  waitingForChild: "ext.state.waitingForChild",
  waitingForContact: "ext.state.waitingForContact",
  active: "ext.state.active",
  blocked: "ext.state.blocked",
  declinedByChild: "ext.state.declinedByChild",
  declinedByContact: "ext.state.declinedByContact",
  expired: "ext.state.expired",
};

/** A new link makes no sense when the child said no or blocked the person (the server answers 409). */
export function canRenewLink(status: ExtendedStatus): boolean {
  return status !== "blocked" && status !== "declinedByChild";
}

/** The coordinates as text, for the copy button. */
export function coordinateText(s: Pick<LocationSnapshot, "lat" | "lon">): string {
  return `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`;
}

/** The clock time a snapshot stops being visible, in the reader's own format. */
export function snapshotUntil(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** What an extended contact's page gets from `GET /family-contact/me`. */
export interface ContactMessage {
  id: string;
  from: "child" | "contact";
  kind: "quick" | "reply" | "snapshot";
  text: string;
  sentAt: string;
  receivedAt: string | null;
  location?: LocationSnapshot | null;
}

export interface ContactView {
  childName: string;
  name: string;
  status: string;
  paused: boolean;
  canReply: boolean;
  messages: ContactMessage[];
}

export interface ContactInvitePreview {
  childName: string;
  contactName: string;
  childApproved: boolean;
  expiresAt: string;
}
