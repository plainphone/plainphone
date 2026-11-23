// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import {
  CompactEncrypt, CompactSign, compactDecrypt, compactVerify, exportPKCS8, exportSPKI,
  generateKeyPair, importPKCS8, importSPKI,
} from "jose";
import { z } from "zod";
import { householdMembers, moveIdentity, moveImports, phoneMoves, phones, users } from "../db/schema.js";
import { dnsClientId, randomToken, sha256 } from "../lib/crypto.js";
import type { Ctx } from "./context.js";
import { isDnsReady, syncDns } from "./dns.js";
import { phoneCapReached, PhoneCapError } from "./phone-cap.js";
import { allowsServerMove, type MoveDb, type MovePhone, policyHash, portablePolicy, readMovePolicy, writeMovePolicy } from "./move-policy.js";

const signingAlg = "EdDSA";
const encryptionAlg = "ECDH-ES";
const contentAlg = "A256GCM";
const lifetimeMs = 7 * 24 * 60 * 60_000;
export const maxMoveBytes = 8 * 1024 * 1024;
const utf8 = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });
const httpsOrigin = z.string().max(300).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && value === url.origin;
  } catch { return false; }
});
const publicKey = z.string().min(1).max(512);
const time = z.iso.datetime();
export const moveSource = z.object({ version: z.literal(1), serverUrl: httpsOrigin, publicKey });
export const moveTicket = z.object({ version: z.literal(1), id: z.uuid(), serverUrl: httpsOrigin, publicKey, expiresAt: time });
const moveToken = z.string().regex(/^pp_m_[A-Za-z0-9_-]{43}$/);
export const redeemMoveInput = z.object({
  token: moveToken,
  deviceToken: z.string().regex(/^pp_d_[A-Za-z0-9_-]{43}$/),
});
const payload = z.object({
  version: z.literal(1),
  id: z.uuid(),
  sourceUrl: httpsOrigin,
  destinationUrl: httpsOrigin,
  expiresAt: time,
  phones: z.array(z.object({ name: z.string().trim().min(1).max(40), policy: portablePolicy, token: moveToken.nullable() })).min(1).max(100),
});

export class MoveError extends Error {
  constructor(readonly status: 400 | 409 | 410 | 503, message: string) { super(message); }
}

function origin(ctx: Ctx) {
  const normalized = httpsOrigin.safeParse(new URL(ctx.cfg.PUBLIC_URL).origin);
  if (!normalized.success) throw new MoveError(409, "moves require a public HTTPS server address");
  return normalized.data;
}

async function identity(ctx: Ctx) {
  let [row] = await ctx.db.select().from(moveIdentity).where(eq(moveIdentity.id, 1));
  if (!row) {
    const keys = await generateKeyPair(signingAlg, { extractable: true });
    await ctx.db.insert(moveIdentity).values({ id: 1, privateKey: await exportPKCS8(keys.privateKey) }).onConflictDoNothing();
    [row] = await ctx.db.select().from(moveIdentity).where(eq(moveIdentity.id, 1));
  }
  return row!.privateKey;
}

export async function sourceIdentity(ctx: Ctx): Promise<z.infer<typeof moveSource>> {
  const serverUrl = origin(ctx);
  const publicKey = createPublicKey(createPrivateKey(await identity(ctx))).export({ type: "spki", format: "pem" });
  return { version: 1, serverUrl, publicKey };
}

export async function prepareImport(ctx: Ctx, householdId: string, source: z.infer<typeof moveSource>) {
  const serverUrl = origin(ctx);
  if (source.serverUrl === serverUrl) throw new MoveError(400, "choose a different server");
  try { await importSPKI(source.publicKey, signingAlg); }
  catch { throw new MoveError(400, "invalid source server key"); }
  const keys = await generateKeyPair(encryptionAlg, { crv: "P-256", extractable: true });
  const expiresAt = new Date(ctx.now().getTime() + lifetimeMs);
  const [row] = await ctx.db.insert(moveImports).values({
    householdId, sourceUrl: source.serverUrl, sourceKey: source.publicKey,
    privateKey: await exportPKCS8(keys.privateKey), expiresAt,
  }).returning({ id: moveImports.id });
  return { version: 1 as const, id: row!.id, serverUrl, publicKey: await exportSPKI(keys.publicKey), expiresAt: expiresAt.toISOString() };
}

export async function exportMove(
  ctx: Ctx, householdId: string, ticket: z.infer<typeof moveTicket>, phoneId?: string,
) {
  const sourceUrl = origin(ctx);
  const expiresAt = new Date(Math.min(Date.parse(ticket.expiresAt), ctx.now().getTime() + lifetimeMs));
  if (expiresAt <= ctx.now()) throw new MoveError(410, "the destination invitation expired");
  if (sourceUrl === ticket.serverUrl) throw new MoveError(400, "choose a different server");
  const signingKey = await importPKCS8(await identity(ctx), signingAlg);
  let recipient;
  try { recipient = await importSPKI(ticket.publicKey, encryptionAlg); }
  catch { throw new MoveError(400, "invalid destination server key"); }

  return ctx.db.transaction(async (tx) => {
    const items = await tx.select().from(phones).where(and(eq(phones.householdId, householdId),
      phoneId ? eq(phones.id, phoneId) : undefined)).orderBy(phones.id).for("update");
    if (!items.length || items.length > 100) throw new MoveError(409, "select between one and 100 phones");
    if (items.some((phone) => phone.awaitingServerMove || phone.releaseRequestedAt || (phone.deviceTokenHash && !phone.pairedAt))) {
      throw new MoveError(409, "finish the current setup or move before exporting");
    }
    const id = randomUUID();
    const snapshot = [];
    for (const phone of items) {
      const policy = await readMovePolicy(tx, phone, ctx.now());
      // An export can copy settings for a disabled phone. Its token can be enabled
      // later only by the normal per-phone controls, including the Myself key.
      const token = phone.pairedAt ? randomToken("pp_m_") : null;
      snapshot.push({ name: phone.name, policy, token });
      if (token) await tx.insert(phoneMoves).values({
        phoneId: phone.id, direction: "outgoing", transferId: id, serverUrl: ticket.serverUrl,
        token, policyHash: policyHash(policy), expiresAt,
      });
    }
    const signed = await new CompactSign(utf8.encode(JSON.stringify({
      version: 1, id: ticket.id, sourceUrl, destinationUrl: ticket.serverUrl,
      expiresAt: expiresAt.toISOString(), phones: snapshot,
    }))).setProtectedHeader({ alg: signingAlg, typ: "plainphone-move-v1" }).sign(signingKey);
    const bundle = await new CompactEncrypt(utf8.encode(signed))
      .setProtectedHeader({ alg: encryptionAlg, enc: contentAlg }).encrypt(recipient);
    if (bundle.length > maxMoveBytes - 1024) throw new MoveError(400, "the bundle is too large; export phones separately");
    return { bundle, exportId: id, phoneIds: items.filter((phone) => phone.pairedAt).map((phone) => phone.id) };
  }, { isolationLevel: "repeatable read" });
}

export async function importMove(ctx: Ctx, householdId: string, ticketId: string, bundle: string) {
  const serverUrl = origin(ctx);
  const phoneIds = await ctx.db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(moveImports)
      .where(and(eq(moveImports.id, ticketId), eq(moveImports.householdId, householdId))).for("update");
    if (!ticket || !ticket.privateKey || ticket.expiresAt <= ctx.now()) {
      throw new MoveError(410, "this invitation expired or was already used");
    }
    let imported;
    try {
      const { plaintext } = await compactDecrypt(bundle, await importPKCS8(ticket.privateKey, encryptionAlg), {
        keyManagementAlgorithms: [encryptionAlg], contentEncryptionAlgorithms: [contentAlg],
      });
      const verified = await compactVerify(decode.decode(plaintext), await importSPKI(ticket.sourceKey, signingAlg), {
        algorithms: [signingAlg],
      });
      if (verified.protectedHeader.typ !== "plainphone-move-v1") throw new Error("wrong bundle type");
      imported = payload.parse(JSON.parse(decode.decode(verified.payload)));
      if (imported.id !== ticket.id || imported.sourceUrl !== ticket.sourceUrl || imported.destinationUrl !== serverUrl) {
        throw new Error("wrong server or invitation");
      }
    } catch {
      throw new MoveError(400, "the bundle is invalid or was signed by a different server");
    }
    const expiresAt = new Date(imported.expiresAt);
    if (expiresAt <= ctx.now() || expiresAt > ticket.expiresAt) throw new MoveError(410, "the bundle expired");

    // Each imported phone registers its own DNS ClientID, so a move counts against HOUSEHOLD_PHONE_CAP
    // like pairing does. The bundle can be signed by any server, so its size proves nothing.
    const refused = await phoneCapReached(ctx, tx, householdId, imported.phones.length);
    if (refused) throw new PhoneCapError(refused.phoneCap);
    const newIds: string[] = [];
    for (const { name, policy, token } of imported.phones) {
      const { profile, mode, filterMethod, timezone, suggestDeviceContacts, lightContactRestriction, selfScheduleContacts,
        allowServerMove, locationMode, locationAlwaysUntil } = policy;
      const helper = policy.key?.trustedEmail;
      const [trusted] = helper ? await tx.select({ id: users.id }).from(users).where(eq(users.email, helper)) : [];
      if (trusted) {
        const [member] = await tx.select().from(householdMembers).where(and(
          eq(householdMembers.householdId, householdId), eq(householdMembers.userId, trusted.id),
        ));
        if (member) throw new MoveError(409, "the trusted helper must use a separate household");
      }
      if (policy.key?.keyType === "trusted" && helper && !trusted) {
        throw new MoveError(409, "ask the trusted helper to sign in on this server before importing");
      }
      const [phone] = await tx.insert(phones).values({
        householdId, name, profile, mode, filterMethod, timezone, suggestDeviceContacts, lightContactRestriction,
        selfScheduleContacts, allowServerMove, dnsClientId: dnsClientId(), awaitingServerMove: token !== null,
        locationMode, locationEnabled: locationMode !== "off",
        locationAlwaysUntil: locationAlwaysUntil ? new Date(locationAlwaysUntil) : null,
      }).returning();
      if (!phone) throw new Error("phone insert returned no row");
      newIds.push(phone.id);
      await writeMovePolicy(tx, phone.id, policy, trusted?.id ?? null);
      if (token) await tx.insert(phoneMoves).values({
        phoneId: phone.id, direction: "incoming", transferId: ticketId, serverUrl: ticket.sourceUrl,
        tokenHash: sha256(token), policyHash: policyHash(policy), expiresAt,
      });
    }
    await tx.update(moveImports).set({ importedAt: ctx.now(), privateKey: null }).where(eq(moveImports.id, ticketId));
    return newIds;
  });
  for (const phoneId of phoneIds) await syncDns(ctx, phoneId);
  return phoneIds;
}

export async function activateMove(ctx: Ctx, db: MoveDb, phone: MovePhone, exportId: string) {
  if (!phone.pairedAt || !allowsServerMove(phone) || phone.releaseRequestedAt) {
    throw new MoveError(409, "allow moving this paired phone before requesting a move");
  }
  const [move] = await db.select().from(phoneMoves).where(and(
    eq(phoneMoves.phoneId, phone.id), eq(phoneMoves.direction, "outgoing"),
    eq(phoneMoves.transferId, exportId), gt(phoneMoves.expiresAt, ctx.now()),
  ));
  if (!move || move.policyHash !== policyHash(await readMovePolicy(db, phone, ctx.now()))) {
    throw new MoveError(409, "this export expired or the phone settings changed; make a new export");
  }
  await db.update(phoneMoves).set({ active: false }).where(and(eq(phoneMoves.phoneId, phone.id), eq(phoneMoves.direction, "outgoing")));
  await db.update(phoneMoves).set({ active: true }).where(eq(phoneMoves.id, move.id));
}

export async function moveInstruction(ctx: Ctx, phone: MovePhone) {
  if (!allowsServerMove(phone) || phone.releaseRequestedAt) return null;
  const [move] = await ctx.db.select().from(phoneMoves).where(and(
    eq(phoneMoves.phoneId, phone.id), eq(phoneMoves.direction, "outgoing"), eq(phoneMoves.active, true),
    gt(phoneMoves.expiresAt, ctx.now()),
  ));
  if (!move?.token || move.policyHash !== policyHash(await readMovePolicy(ctx.db, phone, ctx.now()))) return null;
  return { serverUrl: move.serverUrl, token: move.token };
}

export async function redeemMove(ctx: Ctx, input: z.infer<typeof redeemMoveInput>) {
  return ctx.db.transaction(async (tx) => {
    const [move] = await tx.select().from(phoneMoves).where(and(
      eq(phoneMoves.direction, "incoming"), eq(phoneMoves.tokenHash, sha256(input.token)),
      gt(phoneMoves.expiresAt, ctx.now()),
    )).for("update");
    if (!move) throw new MoveError(410, "this move token expired or was already used");
    const [phone] = await tx.select().from(phones).where(eq(phones.id, move.phoneId)).for("update");
    if (!phone?.awaitingServerMove || phone.releaseRequestedAt || phone.deviceTokenHash) {
      throw new MoveError(410, "this move token expired or was already used");
    }
    if (phone.dnsDirty || !isDnsReady(ctx, phone)) throw new MoveError(503, "the destination filter is not ready");
    if (move.policyHash !== policyHash(await readMovePolicy(tx, phone, ctx.now()))) {
      throw new MoveError(409, "the destination rules changed; make a new export");
    }
    await tx.update(phones).set({ deviceTokenHash: sha256(input.deviceToken) })
      .where(and(eq(phones.id, phone.id), isNull(phones.deviceTokenHash)));
    // The phone only becomes active on its first sync with the new token. Keep the incoming row (and so the
    // sweeper's hands off the token) for a full window after redeeming, so a phone that redeems just before the
    // invitation ends and then loses the network is not locked out.
    const keepUntil = new Date(ctx.now().getTime() + lifetimeMs);
    await tx.update(phoneMoves).set({ tokenHash: null, expiresAt: keepUntil > move.expiresAt ? keepUntil : move.expiresAt })
      .where(eq(phoneMoves.id, move.id));
  });
}

export async function canPreviewMove(ctx: Ctx, phone: MovePhone) {
  if (!phone.awaitingServerMove || phone.releaseRequestedAt || phone.dnsDirty || !isDnsReady(ctx, phone)) return false;
  const [move] = await ctx.db.select({ policyHash: phoneMoves.policyHash }).from(phoneMoves).where(and(
    eq(phoneMoves.phoneId, phone.id), eq(phoneMoves.direction, "incoming"), gt(phoneMoves.expiresAt, ctx.now()),
  ));
  return move !== undefined && move.policyHash === policyHash(await readMovePolicy(ctx.db, phone, ctx.now()));
}
