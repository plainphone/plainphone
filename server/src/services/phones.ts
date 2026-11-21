// SPDX-License-Identifier: Apache-2.0
import { allowsServerMove } from "./move-policy.js";
import { moveInstruction } from "./server-move.js";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  contacts,
  type DeviceStatus,
  type PhoneAttestation,
  type StatusNotice,
  DNS_CATEGORIES,
  dnsSettings,
  locations,
  enrollments,
  pairings,
  pendingChanges,
  phoneApps,
  phoneSettings,
  phoneRequests,
  moreTimeRequests,
  phones,
  schedules,
  selfKeys,
} from "../db/schema.js";
import { capabilities, phoneTier } from "../lib/capabilities.js";
import { iosRulesDocument, loadIosSelection, type IosSelectionMeta } from "./ios-rules.js";
import { dnsClientId } from "../lib/crypto.js";
import { fullHome, fullSettings, rulesSettings } from "../lib/phone-settings.js";
import { fcmValidationKey, type WakeReason } from "../providers/push.js";
import type { Ctx } from "./context.js";
import { enrollmentMatches } from "./enrollment.js";
import { isDnsReady, isRulesDnsReady } from "./dns.js";
import { ATTESTATION_MAX_AGE_MS } from "./attestation.js";
import { householdAccountIds } from "./reset-protection.js";
import { APP_CATEGORIES, categoryPackages } from "../lib/open-mode.js";
import { loadTimeLimits } from "./limits.js";
import { FAST_POLL_SECONDS, loadSafety, safetyForPhone } from "./safety.js";
import { sosRulesExtras } from "./quick-messages.js";
import { agreementRules } from "./age-review.js";
import { inboxRules } from "./family-inbox.js";
import { effectiveGroup, loadModes, modesForRules } from "./modes.js";
import { emergencyRules } from "./emergency-openings.js";

type Phone = typeof phones.$inferSelect;
type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/** How often the phone polls for rules when push is not available. */
export const POLL_SECONDS = 60;
/** How often the phone reports its position when location is on (spec: every 5 minutes). */
export const LOCATION_INTERVAL_MINUTES = 5;
/** What older phones (without `location.mode`) get as interval when the mode is not "always". */
export const OLD_PHONE_INTERVAL_MINUTES = 24 * 60;

/** Starter packs now come from the app catalog (`starter: true`). Re-exported for older imports. */
export { STARTER_PACKS } from "./catalog.js";

export async function createPhone(
  ctx: Ctx,
  tx: Tx,
  input: {
    householdId: string;
    name: string;
    profile: "child" | "self";
    mode: "strong" | "light";
    /** An iPhone starts on Family Controls (docs/ios/architecture.md); default Android. */
    platform?: Phone["platform"];
    /** Null for a phone made for a provisioning QR code: it pairs itself later (enrollment). */
    deviceTokenHash: string | null;
    deviceInfo: Record<string, string> | null;
    timezone?: string;
    language?: Phone["language"];
    filterMethod?: Phone["filterMethod"];
  },
): Promise<Phone> {
  // Runs inside the caller's transaction, together with the pairing it claims.
  const [phone] = await tx
    .insert(phones)
    .values({
      householdId: input.householdId,
      name: input.name,
      profile: input.profile,
      mode: input.mode,
      platform: input.platform ?? "android",
      iosTier: input.platform === "ios" ? "family_controls" : null,
      filterMethod: input.mode === "light" && input.platform !== "ios" ? input.filterMethod : "vpn",
      deviceTokenHash: input.deviceTokenHash,
      deviceInfo: input.deviceInfo,
      dnsClientId: dnsClientId(),
      // D7 and spec 11: a child's phone sends its position only on Find and an unanswered
      // "Are you okay?"; an adult's is off until its owner turns it on.
      // Open mode: an adult's phone starts with every app allowed except what they block.
      openMode: input.profile === "self",
      // Like the web filter, whose categories all start blocked (spec 6): the known social and
      // gambling apps start on the block list, so an app and its websites never disagree.
      blockedAppCategories: input.profile === "self" ? [...APP_CATEGORIES] : [],
      locationEnabled: input.profile === "child",
      locationMode: input.profile === "child" ? "checkin" : "off",
      language: input.language,
      timezone: input.timezone ?? "Europe/Copenhagen",
      pairedAt: input.deviceTokenHash ? ctx.now() : null,
      createdAt: ctx.now(),
    })
    .returning();
  // Spec 6: every category is blocked by default.
  await tx.insert(dnsSettings).values({ phoneId: phone!.id, blockedCategories: [...DNS_CATEGORIES] });
  if (input.profile === "self") await tx.insert(selfKeys).values({ phoneId: phone!.id });
  return phone!;
}

/** Asks the phone to fetch rules (or report its position) now. Polling is the fallback. */
export async function wakePhone(ctx: Ctx, phoneId: string, reason: WakeReason) {
  const [p] = await ctx.db.select({
    enabled: phones.pushWakeups, token: phones.fcmToken, endpoint: phones.unifiedPushEndpoint,
    validationKey: phones.fcmValidationKey,
  }).from(phones).where(eq(phones.id, phoneId));
  if (!p?.enabled) return;
  const column = p.endpoint ? phones.unifiedPushEndpoint : phones.fcmToken;
  const registration = p.endpoint ?? p.token;
  if (!registration || (!p.endpoint && p.validationKey !== fcmValidationKey(ctx.push))) return;
  try {
    if (await ctx.push.wake(registration, reason, p.endpoint ? "unifiedpush" : "fcm") === "gone") {
      const sameValidation = p.validationKey === null ? isNull(phones.fcmValidationKey)
        : eq(phones.fcmValidationKey, p.validationKey);
      await ctx.db.update(phones).set(p.endpoint ? { unifiedPushEndpoint: null } : { fcmToken: null, fcmValidationKey: null })
        .where(and(eq(phones.id, phoneId), eq(column, registration), p.endpoint ? undefined : sameValidation));
    }
  } catch {
    console.error("phone wakeup failed");
  }
}

async function readPhoneSettings(db: Ctx["db"], phoneId: string) {
  const [row] = await db
    .select({ settings: phoneSettings.settings, home: phoneSettings.home })
    .from(phoneSettings)
    .where(eq(phoneSettings.phoneId, phoneId));
  return row;
}

/** The phone's own settings and home screen, with the defaults filled in. */
export async function loadPhoneSettings(db: Ctx["db"], phoneId: string) {
  const row = await readPhoneSettings(db, phoneId);
  return { stored: row?.settings ?? {}, settings: fullSettings(row?.settings), home: fullHome(row?.home) };
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

async function loadRulesInputs(ctx: Ctx, phone: Phone) {
  const [allApps, contactRows, scheduleRows, dnsRow, pending, limits, safetyRows, own, accountIds, sosExtras, inbox, modeRows, emergency] = await Promise.all([
    ctx.db
      .select({
        packageName: phoneApps.packageName,
        label: phoneApps.label,
        installed: phoneApps.installed,
        core: phoneApps.core,
        allowed: phoneApps.allowed,
        explicitlyBlocked: phoneApps.explicitlyBlocked,
        requested: phoneApps.requested,
      })
      .from(phoneApps)
      .where(
        and(
          eq(phoneApps.phoneId, phone.id),
          or(eq(phoneApps.installed, true), and(eq(phoneApps.requested, true), eq(phoneApps.allowed, true))),
        ),
      )
      .orderBy(phoneApps.packageName),
    ctx.db
      .select({ name: contacts.name, number: contacts.number, sosParent: contacts.sosParent, contactGroup: contacts.contactGroup })
      .from(contacts)
      .where(eq(contacts.phoneId, phone.id))
      .orderBy(contacts.name, contacts.number),
    ctx.db
      .select({
        id: schedules.id,
        kind: schedules.kind,
        days: schedules.days,
        startMinute: schedules.startMinute,
        endMinute: schedules.endMinute,
        allowedPackages: schedules.allowedPackages,
      })
      .from(schedules)
      .where(eq(schedules.phoneId, phone.id))
      .orderBy(schedules.createdAt, schedules.id),
    ctx.db
      .select({
        blockedCategories: dnsSettings.blockedCategories,
        allowDomains: dnsSettings.allowDomains,
        blockDomains: dnsSettings.blockDomains,
      })
      .from(dnsSettings)
      .where(eq(dnsSettings.phoneId, phone.id)),
    ctx.db
      .select({
        id: pendingChanges.id,
        op: pendingChanges.op,
        keyType: pendingChanges.keyType,
        effectiveAt: pendingChanges.effectiveAt,
      })
      .from(pendingChanges)
      .where(and(eq(pendingChanges.phoneId, phone.id), eq(pendingChanges.status, "pending")))
      .orderBy(pendingChanges.createdAt),
    loadTimeLimits(ctx.db, phone, ctx.now()),
    loadSafety(ctx, phone.id),
    readPhoneSettings(ctx.db, phone.id),
    householdAccountIds(ctx, phone.householdId),
    sosRulesExtras(ctx, phone),
    inboxRules(ctx, phone),
    phone.modesEnabled && phone.profile === "child" ? loadModes(ctx.db, phone.id) : null,
    emergencyRules(ctx, phone),
  ]);
  const safety = safetyForPhone(phone, safetyRows, ctx.now());
  return {
    phone: {
      id: phone.id,
      platform: phone.platform,
      iosTier: phone.iosTier,
      allowServerMove: allowsServerMove(phone),
      profile: phone.profile,
      pushProvider: !phone.pushWakeups ? "none" : !phone.preferUnifiedPush && ctx.push.fcmAvailable ? "fcm"
        : ctx.push.unifiedPushAvailable ? "unifiedpush" : "none",
      unifiedPushAvailable: phone.pushWakeups && Boolean(ctx.push.unifiedPushAvailable),
      fcmValidationKey: phone.pushWakeups && !phone.preferUnifiedPush && ctx.push.fcmAvailable
        ? fcmValidationKey(ctx.push) : null,
      suggestDeviceContacts: phone.suggestDeviceContacts,
      lightContactRestriction: phone.lightContactRestriction,
      selfScheduleContacts: phone.selfScheduleContacts,
      mode: phone.mode,
      openMode: phone.openMode,
      blockedAppCategories: phone.blockedAppCategories,
      timezone: phone.timezone,
      changeReceiptsEnabled: phone.changeReceiptsEnabled,
      healthBoardEnabled: phone.healthBoardEnabled,
      weeklySummaryEnabled: phone.weeklySummaryEnabled,
      agreement: agreementRules(phone),
      silentBedtime: phone.silentBedtime,
      pinApprovalEnabled: phone.pinApprovalEnabled,
      appUpdatesEnabled: phone.appUpdatesEnabled,
      appUpdatesRequestedAt: phone.appUpdatesRequestedAt,
      appUpdatesReportedWindow: phone.appUpdatesReportedWindow,
      appUpdatesRecordedApps: phone.appUpdatesRecordedApps,
      language: phone.language,
      lockSystemLanguage: phone.lockSystemLanguage,
      dnsHost: `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}`,
      dnsReady: isRulesDnsReady(ctx, phone),
      privateDnsReady: isDnsReady(ctx, phone),
      filterMethod: phone.filterMethod,
      rulesRevision: phone.rulesRevision,
      rulesWaitingForDns: phone.rulesAwaitDns && phone.dnsDirty,
      locationEnabled: phone.locationEnabled,
      locationMode: phone.locationMode,
      locationAlwaysUntil: phone.locationAlwaysUntil,
      locateRequestedAt: phone.locateRequestedAt,
      updateRequestedAt: phone.updateRequestedAt,
      releaseRequestedAt: phone.releaseRequestedAt,
      supportEnabled: phone.supportEnabled,
      releaseWarningsEnabled: phone.releaseWarningsEnabled,
      askMoreTimeEnabled: phone.askMoreTimeEnabled,
      limitWarningEnabled: phone.limitWarningEnabled,
      name: phone.name,
    },
    allApps,
    contactRows,
    scheduleRows,
    dnsRow,
    pending,
    limits,
    safety,
    own,
    accountIds,
    sosExtras,
    inbox,
    modeRows,
    emergency,
  };
}

type RulesInputs = Awaited<ReturnType<typeof loadRulesInputs>>;

/** Advance in the same transaction as the edit, even if it restores an earlier rules document. */
export function nextRulesRevision(dns = false) {
  return {
    rulesRevision: sql`${phones.rulesRevision} + 1`,
    rulesAwaitDns: dns,
    ...(dns ? { dnsDirty: true, dnsVersion: sql`${phones.dnsVersion} + 1` } : {}),
  };
}

/** The rules document the phone fetches. Its ETag is a hash of the content. */
function rulesDocument({ phone, allApps, contactRows, scheduleRows, dnsRow, pending, limits, safety, own, accountIds, sosExtras, inbox, modeRows, emergency }: RulesInputs, move: Awaited<ReturnType<typeof moveInstruction>>, fallbackDnsHost: string | undefined, iosSelection: IosSelectionMeta | null = null) {
  const apps = allApps.filter((a) => a.installed);
  // Open mode: everything is allowed except the block list (apps blocked one by one plus the
  // known apps of the blocked categories, also when they are not installed yet).
  const blocked = new Set(
    phone.openMode
      ? [...apps.filter((a) => a.explicitlyBlocked && !a.core).map((a) => a.packageName), ...categoryPackages(phone.blockedAppCategories)]
      : [],
  );
  const isAllowed = (a: (typeof apps)[number]) => a.core || (phone.openMode ? !blocked.has(a.packageName) : a.allowed);
  const sorted = (xs: string[]) => [...xs].sort();
  // Modes (docs/modes.md) replace the school time and bedtime table with windows built from the slots.
  const modes = modeRows && modesForRules(modeRows.modes, modeRows.slots, [
    ...apps.filter(isAllowed).map((a) => a.packageName),
    ...allApps.filter((a) => a.requested && a.allowed && !a.installed).map((a) => a.packageName),
  ]);
  const doc = {
    phoneId: phone.id,
    allowServerMove: phone.allowServerMove,
    ...(move && { move }),
    // This server's provisioning host, which answers for any ClientID. A phone falls back to it when its own
    // filter host stops answering (removed, deleted, or not ready), also after moving here from another server.
    fallbackDnsHost: fallbackDnsHost ?? null,
    pushProvider: phone.pushProvider,
    unifiedPushAvailable: phone.unifiedPushAvailable,
    ...(phone.fcmValidationKey ? { fcmValidationKey: phone.fcmValidationKey } : {}),
    profile: phone.profile,
    suggestDeviceContacts: phone.profile === "child" && phone.suggestDeviceContacts,
    lightContactRestriction: phone.mode === "light" && phone.profile === "child" && phone.lightContactRestriction,
    selfScheduleContacts: phone.selfScheduleContacts,
    mode: phone.mode,
    timezone: phone.timezone,
    changeReceiptsEnabled: phone.changeReceiptsEnabled,
    healthBoardEnabled: phone.healthBoardEnabled,
    weeklySummaryEnabled: phone.weeklySummaryEnabled,
    silentBedtime: phone.silentBedtime,
    pinApprovalEnabled: phone.profile === "child" && phone.pinApprovalEnabled,
    language: phone.language,
    lockSystemLanguage: phone.mode === "strong" && phone.profile === "child" && phone.lockSystemLanguage,
    apps: {
      allowed: sorted(apps.filter(isAllowed).map((a) => a.packageName)),
      hidden: sorted(apps.filter((a) => !isAllowed(a)).map((a) => a.packageName)),
      // True: the phone allows every app that is not in `blocked`, also ones installed later.
      open: phone.openMode,
      blocked: sorted([...blocked]),
      // Picked from the catalog but not installed yet: the phone offers to install them.
      toInstall: allApps
        .filter((a) => a.requested && a.allowed && !a.installed)
        .map((a) => ({ packageName: a.packageName, label: a.label })),
    },
    timeLimits: { total: limits.total, apps: limits.apps.map((a) => ({ packageName: a.packageName, ...a.limit })), bonuses: limits.bonuses },
    contacts: contactRows.map((c) => ({ name: c.name, number: c.number, ...(modes ? { group: effectiveGroup(c) } : {}) })),
    ...(phone.profile === "child" ? { sos: { name: phone.name, parents: contactRows.filter((c) => c.sosParent).map(({ name, number }) => ({ name, number })), ...sosExtras } } : {}),
    // The family inbox (docs/family-inbox.md); left out while it is off.
    ...(inbox ? { inbox } : {}),
    // The family agreement (docs/family-agreement.md); left out while it is off or empty.
    ...(phone.agreement ? { ageAgreement: phone.agreement } : {}),
    // Limited emergency openings, Self phones only (docs/emergency-openings.md). `used` is the
    // server's count for this month in the phone's time zone; the phone counts for itself too.
    ...(emergency ? { selfEmergency: emergency } : {}),
    schedules: modes ? modes.schedules : scheduleRows.map((s) => ({
      id: s.id,
      kind: s.kind,
      days: s.days,
      start: hhmm(s.startMinute),
      end: hhmm(s.endMinute),
      allowedPackages: sorted(s.allowedPackages),
    })),
    ...(modes ? { modes: modes.block } : {}),
    dns: {
      host: phone.dnsHost,
      // The phone switches to `host` only when this is true: the DNS service refuses ClientIDs
      // it has not accepted yet, and a phone on a refusing resolver has no DNS at all.
      ready: phone.dnsReady,
      ...(phone.mode === "light" ? { privateDnsReady: phone.privateDnsReady } : {}),
      filterMethod: phone.filterMethod,
      blockedCategories: sorted(dnsRow[0]?.blockedCategories ?? []),
    },
    rulesRevision: phone.rulesRevision,
    // A DNS edit needs a new acknowledgment once the resolver has accepted it.
    // A resolver retry must not invalidate an acknowledgment of a later phone-side edit.
    dnsRevision: createHash("sha256").update(JSON.stringify([
      sorted(dnsRow[0]?.allowDomains ?? []), sorted(dnsRow[0]?.blockDomains ?? []), phone.rulesWaitingForDns,
    ])).digest("base64url"),
    location: {
      enabled: phone.locationEnabled,
      mode: phone.locationMode,
      alwaysUntil: phone.locationMode === "always" ? (phone.locationAlwaysUntil?.toISOString() ?? null) : null,
      // Phones from before `mode` report every intervalMinutes while enabled: give them a day
      // unless the parent chose "always".
      intervalMinutes: phone.locationMode === "always" ? LOCATION_INTERVAL_MINUTES : OLD_PHONE_INTERVAL_MINUTES,
      requestedAt: phone.locationEnabled ? (phone.locateRequestedAt?.toISOString() ?? null) : null,
    },
    // Only settings that are not free, keys in alphabetical order (a stable ETag).
    settings: rulesSettings(own?.settings ?? {}),
    home: fullHome(own?.home),
    update: { requestedAt: phone.updateRequestedAt?.toISOString() ?? null },
    // Strong mode: the nightly window for updates of approved apps, and "Update apps now".
    appUpdates: {
      automatic: phone.appUpdatesEnabled,
      requestedAt: phone.appUpdatesRequestedAt?.toISOString() ?? null,
      reportedWindow: phone.appUpdatesReportedWindow,
      recordedApps: sorted(phone.appUpdatesRecordedApps),
    },
    ring: safety.ring,
    checkIn: safety.checkIn,
    pendingChanges: pending.map((c) => ({
      id: c.id,
      op: c.op,
      keyType: c.keyType,
      effectiveAt: c.effectiveAt?.toISOString() ?? null,
    })),
    // Factory reset protection (#20): Google account IDs that may set the phone up after a reset.
    resetProtection: { accountIds },
    // True once the parents have released the phone: it switches Plainphone off and then
    // calls POST /device/released. Older phones ignore the field.
    release: phone.releaseRequestedAt !== null,
    supportEnabled: phone.supportEnabled,
    releaseWarningsEnabled: phone.releaseWarningsEnabled,
    askMoreTimeEnabled: phone.askMoreTimeEnabled,
    limitWarningEnabled: phone.limitWarningEnabled,
    pollSeconds: safety.fast ? FAST_POLL_SECONDS : POLL_SECONDS,
  };
  // An iPhone gets the part it can act on (docs/ios/architecture.md, "iOS rules document").
  const tier = phoneTier(phone);
  const body = JSON.stringify(phone.platform === "ios"
    ? iosRulesDocument(doc, tier, capabilities(tier), phone.openMode, iosSelection)
    : doc);
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  return { body, etag };
}

export async function respondWithRules(ctx: Ctx, phone: Phone, candidates: string[]) {
  const [inputs, move, iosSelection] = await Promise.all([
    loadRulesInputs(ctx, phone), moveInstruction(ctx, phone),
    phone.platform === "ios" ? loadIosSelection(ctx.db, phone.id) : null,
  ]);
  const { body, etag } = rulesDocument(inputs, move, ctx.cfg.PROVISIONING_DNS_HOST, iosSelection);
  return { etag, body: candidates.includes(etag) ? null : body, hasMove: move !== null };
}

function summaryFields() {
  // Qualify the outer reference even in Drizzle's single-table select.
  const phoneId = sql`${phones}.${sql.identifier(phones.id.name)}`;
  return {
    hasCodeClaim: sql<boolean>`exists (select 1 from ${pairings}
      where ${pairings.phoneId} = ${phoneId} and ${pairings.requiresConfirmation})`,
    hasLocation: sql<boolean>`exists (select 1 from ${locations} where ${locations.phoneId} = ${phoneId})`,
    openRequests: sql<number>`(select count(*)::int from ${phoneRequests}
      where ${phoneRequests.phoneId} = ${phoneId} and ${phoneRequests.status} = 'pending')`,
    openMoreTimeRequests: sql<number>`(select count(*)::int from ${moreTimeRequests}
      where ${moreTimeRequests.phoneId} = ${phoneId} and ${moreTimeRequests.status} = 'pending')`,
  };
}

export async function phoneSummaries(ctx: Ctx, householdIds: string[]) {
  const rows = await ctx.db
    .select({ phone: phones, ...summaryFields() })
    .from(phones)
    .where(inArray(phones.householdId, householdIds))
    .orderBy(phones.createdAt);
  return rows.map(({ phone, hasLocation, openRequests, openMoreTimeRequests, hasCodeClaim }) =>
    summaryJson(ctx, phone, hasLocation, openRequests, hasCodeClaim, openMoreTimeRequests));
}

export async function phoneSummary(ctx: Ctx, phone: Phone) {
  const [[row], current] = await Promise.all([
    ctx.db.select({
      phone: phones,
      ...summaryFields(),
      setupEnrollment: sql<Pick<typeof enrollments.$inferSelect, "id" | "provisioning" | "invalidatedAt"> | null>`
        (select jsonb_build_object('id', ${enrollments.id}, 'provisioning', ${enrollments.provisioning}, 'invalidatedAt', null)
         from ${enrollments}
         where ${enrollments.phoneId} = ${phones}.${sql.identifier(phones.id.name)}
           and ${enrollments.invalidatedAt} is null and ${enrollments.usedAt} is null
           and ${enrollments.provisioning} is not null
           and ${enrollments.expiresAt} > ${ctx.now().toISOString()}::timestamptz
         order by ${enrollments.createdAt} desc limit 1)`,
    }).from(phones).where(eq(phones.id, phone.id)),
    respondWithRules(ctx, phone, []),
  ]);
  const summary = summaryJson(ctx, row?.phone ?? phone, row?.hasLocation ?? false, row?.openRequests ?? 0, row?.hasCodeClaim ?? false, row?.openMoreTimeRequests ?? 0);
  const status = phone.deviceStatus;
  const confirmed = phone.changeReceiptsEnabled && phone.pairedAt && !(phone.rulesAwaitDns && phone.dnsDirty) &&
    status?.rulesEtag === current.etag && status.rulesAppliedAt &&
    status.rulesReceiptConfirmed === true;
  const ruleReceipt = phone.changeReceiptsEnabled && phone.pairedAt ? {
    needsUpdate: status?.rulesReceiptConfirmed === undefined && status?.rulesEtag != null,
    appliedAt: confirmed ? status.rulesAppliedAt : null,
    // A clock ahead can still carry a valid acknowledgment. Display the server's receipt time separately.
    confirmedAt: confirmed ? status.rulesReceiptReceivedAt ?? phone.statusReportedAt?.toISOString() ?? null : null,
  } : null;
  return {
    ...summary,
    ruleReceipt,
    /** Whether the phone has confirmed the rules the server holds now; null while it has confirmed none. */
    rulesCurrent: !phone.deviceStatus?.rulesEtag ? null
      // With receipts on, "current" needs the same proof as the receipt, so header and receipt agree.
      : phone.changeReceiptsEnabled && phone.pairedAt ? !!confirmed
      : phone.deviceStatus.rulesEtag === current.etag,
    setupEnrollmentId: summary.setupQrAvailable && row?.setupEnrollment && enrollmentMatches(ctx, row.setupEnrollment, row.phone)
      ? row.setupEnrollment.id
      : null,
  };
}

const STATUS_NOTICE_TTL_MS = 7 * 24 * 60 * 60_000;

export function isInstallOverrun(policy: string): boolean {
  return /^install window overran: \d+s$/.test(policy);
}

export function installOverrunFromStatus(
  status: Phone["deviceStatus"],
  reportedAt: Date | null,
): NonNullable<Phone["deviceStatus"]>["installOverrun"] {
  if (status?.installOverrun) return status.installOverrun;
  // Older snapshots kept the notice in failedPolicies with only the status timestamp.
  const policy = status?.failedPolicies.find(isInstallOverrun);
  return policy && reportedAt ? { policy, receivedAt: reportedAt.toISOString() } : undefined;
}

export function parallelAppsRemovalFromStatus(
  status: Phone["deviceStatus"],
  reportedAt: Date | null,
): StatusNotice | undefined {
  return status?.parallelAppsRemovedNotice ??
    (status?.parallelAppsRemoved && reportedAt ? { receivedAt: reportedAt.toISOString() } : undefined);
}

function visibleNotice(notice: StatusNotice | undefined, now: Date): true | undefined {
  return notice && now.getTime() - Date.parse(notice.receivedAt) < STATUS_NOTICE_TTL_MS ? true : undefined;
}

function summaryStatus(phone: Phone, now: Date) {
  if (!phone.deviceStatus || !phone.statusReportedAt) return null;
  const { installOverrun: _storedOverrun, parallelAppsRemovedNotice: _storedRemoval,
    lateGoogleAccountNotice, clockMovedNotice, rulesReceiptReceivedAt: _receiptReceivedAt,
    lastConfirmedFilterWorking: _filterBaseline, lockIntactWithoutFilter: _lockBaseline,
    liftedOverdueAlertedAt: _liftedAlerted, ...status } = phone.deviceStatus;
  const overrun = installOverrunFromStatus(phone.deviceStatus, phone.statusReportedAt);
  const showOverrun = overrun && now.getTime() - Date.parse(overrun.receivedAt) < STATUS_NOTICE_TTL_MS;
  let failedPolicies = status.failedPolicies.filter((policy) => !isInstallOverrun(policy));
  // Reserve a slot based on the phone report before adding server-side attestation.
  if (showOverrun) failedPolicies = [overrun.policy, ...failedPolicies.slice(0, 49)];
  return {
    ...withAttestation({ ...status, failedPolicies }, phone.attestation),
    parallelAppsRemoved: visibleNotice(parallelAppsRemovalFromStatus(phone.deviceStatus, phone.statusReportedAt), now),
    lateGoogleAccount: visibleNotice(lateGoogleAccountNotice, now),
    clockMoved: visibleNotice(clockMovedNotice, now),
    reportedAt: phone.statusReportedAt.toISOString(),
  };
}

function summaryJson(ctx: Ctx, phone: Phone, hasLocation: boolean, openRequests: number, hasCodeClaim: boolean, openMoreTimeRequests = 0) {
  return {
    id: phone.id,
    name: phone.name,
    profile: phone.profile,
    mode: phone.mode,
    platform: phone.platform,
    tier: phoneTier(phone),
    /** What this platform and tier can do, per feature (docs/ios/architecture.md). */
    capabilities: capabilities(phoneTier(phone)),
    openMode: phone.openMode,
    timezone: phone.timezone,
    language: phone.language,
    lockSystemLanguage: phone.mode === "strong" && phone.profile === "child" && phone.lockSystemLanguage,
    locationEnabled: phone.locationEnabled,
    locationMode: phone.locationMode,
    pairedAt: phone.pairedAt?.toISOString() ?? null,
    allowServerMove: allowsServerMove(phone),
    awaitingServerMove: phone.awaitingServerMove,
    setupQrAvailable: phone.pairedAt === null && phone.deviceTokenHash === null && !hasCodeClaim && !phone.awaitingServerMove,
    /** Set while the phone has been asked to switch Plainphone off and has not done so yet. */
    releaseRequestedAt: phone.releaseRequestedAt?.toISOString() ?? null,
    releaseSyncCount: phone.releaseSyncCount,
    supportEnabled: phone.supportEnabled,
    releaseWarningsEnabled: phone.releaseWarningsEnabled,
    askMoreTimeEnabled: phone.askMoreTimeEnabled,
    limitWarningEnabled: phone.limitWarningEnabled,
    androidVersion: phone.supportEnabled ? phone.deviceStatus?.androidVersion ?? phone.deviceInfo?.android ?? null : null,
    lastSeenAt: phone.lastSeenAt?.toISOString() ?? null,
    // The address is only shown once the resolver confirmed it (`dnsReady`); the phone itself is
    // filtered as soon as `rulesDnsReady`, so "waiting" texts follow that one.
    dnsHost: isDnsReady(ctx, phone) ? `${phone.dnsClientId}.${ctx.cfg.DNS_HOST_SUFFIX}` : null,
    dnsSynced: !phone.dnsDirty,
    dnsConfigured: ctx.cfg.DNS_PROVIDER === "http",
    dnsReady: isDnsReady(ctx, phone),
    rulesDnsReady: isRulesDnsReady(ctx, phone),
    hasLocation: phone.locationMode !== "off" && hasLocation,
    // Hardware attestation of the boot state (#23); null until the phone attested once.
    attestation: phone.attestation
      ? {
          ...phone.attestation,
          state: phone.attestation.state === "verified" &&
            (!phone.attestedAt || ctx.now().getTime() - phone.attestedAt.getTime() >= ATTESTATION_MAX_AGE_MS)
            ? "unverifiable" as const
            : legacyAmbiguousAttestation(phone.attestation) ? "unverifiable" : phone.attestation.state,
          checkedAt: phone.attestedAt?.toISOString() ?? null,
        }
      : null,
    openRequests,
    openMoreTimeRequests,
    pushWakeups: phone.pushWakeups,
    preferUnifiedPush: phone.preferUnifiedPush,
    /** Null means the server default (`offlineAlertHoursDefault`). */
    offlineAlertHours: phone.offlineAlertHours,
    offlineAlertHoursDefault: ctx.cfg.OFFLINE_ALERT_HOURS,
    changeReceiptsEnabled: phone.changeReceiptsEnabled,
    healthBoardEnabled: phone.healthBoardEnabled,
    weeklySummaryEnabled: phone.weeklySummaryEnabled,
    agePreset: phone.agePreset,
    reviewEnabled: phone.reviewEnabled,
    reviewIntervalMonths: phone.reviewIntervalMonths,
    reviewDueAt: phone.reviewEnabled ? phone.reviewDueAt?.toISOString() ?? null : null,
    reviewDue: phone.reviewEnabled && phone.reviewDueAt !== null && phone.reviewDueAt.getTime() <= ctx.now().getTime(),
    agreementEnabled: phone.agreementEnabled,
    agreementOnHome: phone.agreementOnHome,
    agreementHasText: phone.agreementLines.length + phone.agreementAdultLines.length > 0,
    silentBedtime: phone.silentBedtime,
    pinApprovalEnabled: phone.pinApprovalEnabled,
    modesEnabled: phone.profile === "child" && phone.modesEnabled,
    appUpdatesEnabled: phone.appUpdatesEnabled,
    appUpdatesRequestedAt: phone.appUpdatesRequestedAt?.toISOString() ?? null,
    status: summaryStatus(phone, ctx.now()),
  };
}

/** States in which the lock cannot be trusted, whatever the phone itself reports (#23). */
export const UNTRUSTED_BOOT = new Set(["unlocked", "custom-os", "failed-boot"]);

function legacyAmbiguousAttestation(attestation: PhoneAttestation): boolean {
  return attestation.state === "revoked" ||
    (attestation.state === "unlocked" && attestation.deviceLocked === false && attestation.verifiedBootState === "verified");
}

/** A negative boot verdict counts as a broken lock in the dashboard. */
export function withAttestation(status: DeviceStatus, attestation: PhoneAttestation | null): DeviceStatus {
  if (!attestation || !UNTRUSTED_BOOT.has(attestation.state) || legacyAmbiguousAttestation(attestation)) return status;
  return {
    ...status,
    lockIntact: false,
    failedPolicies: [...status.failedPolicies, `hardware attestation: ${attestation.state}`],
  };
}
