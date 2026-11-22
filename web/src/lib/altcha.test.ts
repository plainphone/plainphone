// SPDX-License-Identifier: Apache-2.0
//
// The shared ALTCHA solver (packages/shared/src/altcha.ts), used by the dashboard and the parent app.
import { createHash } from "node:crypto";
import { AltchaAborted, findNumber, sha256Hex, solveAltcha } from "@plainphone/shared/altcha";
import { expect, it } from "vitest";

const salt = "0123456789abcdef01234567?expires=1795368827";
const challengeFor = (n: number, maxnumber = 5_000) => ({
  algorithm: "SHA-256" as const,
  challenge: createHash("sha256").update(salt + n).digest("hex"),
  maxnumber,
  salt,
  signature: "cd".repeat(32),
});
const sync = async () => undefined;

it("hashes like SHA-256 across the block boundaries", () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 200]) {
    const text = "x".repeat(len);
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
  }
});

it("finds the number at both ends of the range, and nothing outside it", () => {
  for (const n of [0, 1, 9, 10, 4_999, 5_000]) expect(findNumber(challengeFor(n), 0, 5_000)).toBe(n);
  expect(findNumber(challengeFor(5_001), 0, 5_000)).toBeNull();
});

it("returns the payload the server reads", async () => {
  const c = challengeFor(1_234);
  const payload = JSON.parse(atob(await solveAltcha(c, { yieldNow: sync })));
  expect(payload).toMatchObject({ algorithm: "SHA-256", challenge: c.challenge, number: 1_234, salt, signature: c.signature });
});

it("works in slices and reports progress, so the screen stays responsive", async () => {
  const shares: number[] = [];
  let yields = 0;
  await solveAltcha(challengeFor(4_500), { slice: 1_000, onProgress: (s) => shares.push(s), yieldNow: async () => { yields++; } });
  expect(yields).toBe(4);
  expect(shares.at(-1)).toBe(1);
  expect(shares).toEqual([...shares].sort((a, b) => a - b));
});

it("stops when aborted and rejects a challenge it cannot solve", async () => {
  const abort = new AbortController();
  const running = solveAltcha(challengeFor(4_999), { slice: 100, signal: abort.signal, yieldNow: async () => abort.abort() });
  await expect(running).rejects.toBeInstanceOf(AltchaAborted);
  await expect(solveAltcha(challengeFor(9_999), { yieldNow: sync })).rejects.toThrow("no solution");
  await expect(solveAltcha({ ...challengeFor(1), algorithm: "SHA-512" as never }, { yieldNow: sync })).rejects.toThrow("unsupported");
});
