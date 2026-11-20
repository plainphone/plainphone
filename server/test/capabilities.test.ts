// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phones } from "../src/db/schema.js";
import { capabilities, FEATURES, phoneTier } from "../src/lib/capabilities.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

describe("capability derivation", () => {
  it("takes Android's tier from the mode and an iPhone's from its iOS tier", () => {
    expect(phoneTier({ platform: "android", mode: "strong", iosTier: null })).toBe("strong");
    expect(phoneTier({ platform: "android", mode: "light", iosTier: null })).toBe("light");
    // A stray iOS tier on an Android phone must not change it.
    expect(phoneTier({ platform: "android", mode: "light", iosTier: "supervised" })).toBe("light");
    expect(phoneTier({ platform: "ios", mode: "strong", iosTier: null })).toBe("family_controls");
    expect(phoneTier({ platform: "ios", mode: "strong", iosTier: "supervised" })).toBe("supervised");
  });

  it("gives every feature an answer in every tier", () => {
    for (const tier of ["strong", "light", "family_controls", "supervised"] as const) {
      expect(Object.keys(capabilities(tier)).sort()).toEqual([...FEATURES].sort());
    }
  });

  // Each row tells the tiers apart, so a swapped or copied table gives a different answer.
  it.each([
    ["contacts", { strong: "yes", light: "yes", family_controls: "partial", supervised: "partial" }],
    ["apps", { strong: "yes", light: "partial", family_controls: "partial", supervised: "yes" }],
    ["webFilter", { strong: "yes", light: "yes", family_controls: "partial", supervised: "yes" }],
    ["factoryResetBlock", { strong: "yes", light: "no", family_controls: "no", supervised: "yes" }],
    ["resetProtection", { strong: "yes", light: "no", family_controls: "yes", supervised: "yes" }],
    ["calmHome", { strong: "yes", light: "yes", family_controls: "no", supervised: "yes" }],
    ["callLog", { strong: "yes", light: "yes", family_controls: "no", supervised: "no" }],
    ["release", { strong: "yes", light: "yes", family_controls: "yes", supervised: "partial" }],
    ["bedtimeSilence", { strong: "yes", light: "yes", family_controls: "partial", supervised: "partial" }],
  ] as const)("maps %s per the parity matrix", (feature, expected) => {
    for (const [tier, support] of Object.entries(expected)) {
      expect(capabilities(tier as keyof typeof expected)[feature], `${feature} in ${tier}`).toBe(support);
    }
  });

  it("returns a copy, so a caller cannot change the table", () => {
    capabilities("strong").contacts = "no";
    expect(capabilities("strong").contacts).toBe("yes");
  });
});

describe("capabilities in the phone summary", () => {
  it("treats existing phones as Android in their current mode", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId } = await pairPhone(h, mum, { name: "Alma", profile: "child" });
    const phone = (await mum.get(`/api/phones/${phoneId}`)).json;
    expect(phone).toMatchObject({ platform: "android", tier: "strong", mode: "strong" });
    expect(phone.capabilities).toEqual(capabilities("strong"));
  });

  it("derives an iPhone's map from its tier, in the list and on the phone", async () => {
    const mum = await signIn(h, "mum@example.org");
    const { phoneId } = await pairPhone(h, mum, { name: "Alma", profile: "child" });
    await h.ctx.db.update(phones).set({ platform: "ios" }).where(eq(phones.id, phoneId));
    const one = (await mum.get(`/api/phones/${phoneId}`)).json;
    expect(one).toMatchObject({ platform: "ios", tier: "family_controls" });
    expect(one.capabilities).toMatchObject({ contacts: "partial", calmHome: "no", sos: "yes" });
    expect((await mum.get("/api/phones")).json.phones[0].capabilities).toEqual(one.capabilities);

    await h.ctx.db.update(phones).set({ iosTier: "supervised" }).where(eq(phones.id, phoneId));
    const supervised = (await mum.get(`/api/phones/${phoneId}`)).json;
    expect(supervised).toMatchObject({ tier: "supervised" });
    expect(supervised.capabilities).toMatchObject({ calmHome: "yes", contacts: "partial" });
  });
});
