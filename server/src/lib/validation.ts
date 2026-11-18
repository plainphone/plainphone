// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { DNS_CATEGORIES } from "../db/schema.js";

export const email = z
  .string()
  .trim()
  .max(254)
  .transform((s) => s.toLowerCase())
  .pipe(z.email());

export const locale = z.enum(["en", "da"]);

/** Android package name, e.g. com.spotify.music */
export const packageName = z
  .string()
  .max(255)
  .regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/, "invalid package name");

/** E.164 phone number, e.g. +4512345678 */
export const phoneNumber = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, "use international format, e.g. +4512345678"));

export const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^\*\./, "").replace(/\.$/, ""))
  .pipe(
    z
      .string()
      .max(253)
      .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/, "invalid domain"),
  );

export const dnsCategory = z.enum(DNS_CATEGORIES);

export const scheduleInput = z
  .object({
    kind: z.enum(["school", "bedtime"]),
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .transform((d) => [...new Set(d)].sort()),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
    allowedPackages: z.array(packageName).max(50).default([]),
  })
  .refine((s) => s.startMinute !== s.endMinute, { message: "start and end must differ" });

export type ScheduleInput = z.infer<typeof scheduleInput>;

/**
 * Where pay-to-unlock money goes (D13). The charity short list is not decided yet,
 * so only the project itself is offered for now.
 */
export const PAY_UNLOCK_RECIPIENTS = ["plainphone"] as const;

export const keyInput = z
  .object({
    keyType: z.enum(["delay", "trusted"]),
    delayHours: z.number().int().min(1).max(72),
    trustedEmail: email.nullable().default(null),
    qrInvite: z.boolean().optional(),
    payUnlockEnabled: z.boolean(),
    payUnlockAmount: z.number().int().min(100).max(10_000_000),
    payUnlockRecipient: z.enum(PAY_UNLOCK_RECIPIENTS),
  })
  .refine((k) => k.keyType !== "trusted" || k.trustedEmail || k.qrInvite, {
    message: "a trusted person needs an email address or a QR invitation",
    path: ["trustedEmail"],
  });

export type KeyInput = z.infer<typeof keyInput>;
