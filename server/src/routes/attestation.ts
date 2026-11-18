// SPDX-License-Identifier: Apache-2.0
//
// Hardware key attestation from the phone (#23). Contract: server/openapi.yaml, tag "device".

import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { phones } from "../db/schema.js";
import { body, RateLimiter } from "../lib/http.js";
import { AttestationVerifierUnavailable, ChallengeMismatch, newChallenge, RevocationList, UNVERIFIABLE_ATTESTATION, verifyAttestation } from "../services/attestation.js";
import { notifyHousehold, protectionLost } from "../services/notifications.js";
import { UNTRUSTED_BOOT, withAttestation } from "../services/phones.js";
import type { Ctx } from "../services/context.js";

type Phone = typeof phones.$inferSelect;
type DeviceEnv = { Variables: { phone: Phone } };

const CHALLENGE_TTL_MS = 10 * 60_000;

export function attestationRoutes(ctx: Ctx) {
  const revocations = ctx.attestation?.revocations ?? new RevocationList();
  const challengeFor = ctx.attestation?.challenge ?? newChallenge;
  // One open challenge per phone, in memory: a restart only means the phone asks again.
  const challenges = new Map<string, { value: Buffer; expiresAt: number }>();
  const limit = new RateLimiter(20, 24 * 60 * 60_000);

  return (app: Hono<DeviceEnv>) => {
    app.post("/attestation/challenge", (c) => {
      const phone = c.get("phone");
      if (!limit.take(phone.id)) throw new HTTPException(429, { message: "too many attestations" });
      const now = ctx.now().getTime();
      for (const [k, v] of challenges) if (v.expiresAt <= now) challenges.delete(k);
      const value = challengeFor();
      challenges.set(phone.id, { value, expiresAt: now + CHALLENGE_TTL_MS });
      return c.json({ challenge: value.toString("base64url"), expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString() });
    });

    app.put("/attestation", async (c) => {
      const phone = c.get("phone");
      const input = await body(
        c,
        z.object({
          challenge: z.string().min(1).max(100),
          chain: z.array(z.string().min(1).max(12_000)).max(10).refine((chain) => chain.length !== 1),
        }),
      );
      const open = challenges.get(phone.id);
      const now = ctx.now().getTime();
      if (!open || open.expiresAt <= now || open.value.toString("base64url") !== input.challenge) {
        return c.json({ error: "unknown or expired challenge; ask for a new one" }, 409);
      }
      challenges.delete(phone.id);
      let result;
      let verifierUnavailable = false;
      try {
        result = input.chain.length === 0 ? UNVERIFIABLE_ATTESTATION : verifyAttestation(
          input.chain.map((s) => Buffer.from(s, "base64")),
          open.value,
          await revocations.get(now),
          now,
        );
      } catch (err) {
        if (err instanceof ChallengeMismatch) return c.json({ error: err.message }, 400);
        if (!(err instanceof AttestationVerifierUnavailable)) {
          return c.json({ error: `chain does not verify: ${(err as Error).message}` }, 400);
        }
        verifierUnavailable = true;
        result = UNVERIFIABLE_ATTESTATION;
      }
      const checkedAt = new Date(now).toISOString();
      const keepFinding = sql`${result.state === "unverifiable"} and
        old.attestation->>'state' in (${sql.join([...UNTRUSTED_BOOT].map((state) => sql`${state}`), sql`, `)}) and
        not (old.attestation->>'state' = 'unlocked' and
          old.attestation @> '{"deviceLocked":false,"verifiedBootState":"verified"}'::jsonb)`;
      // Keep the finding and its original timestamp when the new check could not establish boot state.
      const [previous] = await ctx.db.execute<{
        attestation: Phone["attestation"]; status: Phone["deviceStatus"]; stored: Phone["attestation"];
      }>(sql`
        with old as (select attestation, attested_at, device_status from phones where id = ${phone.id} for update)
        update phones set attestation = case when ${keepFinding}
            then old.attestation || ${JSON.stringify({ lastFailedAt: checkedAt })}::jsonb
            else ${JSON.stringify(result)}::jsonb end,
          attested_at = case when ${keepFinding} then old.attested_at else ${checkedAt}::timestamptz end
        from old where phones.id = ${phone.id}
        returning old.attestation as attestation, old.device_status as status, phones.attestation as stored`);
      if (previous?.status) {
        const lost = protectionLost(
          withAttestation(previous.status, previous.attestation),
          withAttestation(previous.status, previous.stored),
        );
        if (lost) await notifyHousehold(ctx, phone.id, { type: "protection", phoneId: phone.id, phoneName: phone.name, reason: lost });
      }
      if (verifierUnavailable) return c.json({ error: "certificate verifier unavailable" }, 503);
      return c.json(result);
    });
  };
}
