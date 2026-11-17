// SPDX-License-Identifier: Apache-2.0
//
// Hardware key attestation from the phone (#23). Contract: server/openapi.yaml, tag "device".

import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { phones } from "../db/schema.js";
import { body, RateLimiter } from "../lib/http.js";
import { ChallengeMismatch, newChallenge, RevocationList, verifyAttestation } from "../services/attestation.js";
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
          chain: z.array(z.string().min(1).max(12_000)).min(2).max(10),
        }),
      );
      const open = challenges.get(phone.id);
      const now = ctx.now().getTime();
      if (!open || open.expiresAt <= now || open.value.toString("base64url") !== input.challenge) {
        return c.json({ error: "unknown or expired challenge; ask for a new one" }, 409);
      }
      challenges.delete(phone.id);
      let result;
      try {
        result = verifyAttestation(
          input.chain.map((s) => Buffer.from(s, "base64")),
          open.value,
          await revocations.get(now),
        );
      } catch (err) {
        if (err instanceof ChallengeMismatch) return c.json({ error: err.message }, 400);
        return c.json({ error: `chain does not verify: ${(err as Error).message}` }, 400);
      }
      await ctx.db.update(phones).set({ attestation: result, attestedAt: ctx.now() }).where(eq(phones.id, phone.id));
      return c.json(result);
    });
  };
}
