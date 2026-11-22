// SPDX-License-Identifier: Apache-2.0
//
// The Child role on an iPhone (docs/ios/architecture.md, phase 1): the pairing state machine, one
// rules sync with its status upload, and the setup wizard's order.
import { deviceFetch } from "../src/lib/iphone/device-api";
import { pairingReducer, pollPairing, startPairing, type PairingState, type ShownCode } from "../src/lib/iphone/pairing";
import { emptyMemory, statusBody, syncOnce } from "../src/lib/iphone/sync";
import { currentStep, progress, type WizardFacts } from "../src/lib/iphone/wizard";
import { fakeApi } from "../test/fakeApi";
import { fakeScreenTime } from "../test/fakeScreenTime";
// The same document the Swift unit tests decode, checked against the server by
// server/test/ios-contract.test.ts.
import fixture from "../../ios/Tests/Fixtures/ios-rules.json";

const SERVER = "https://pp.example.org";
const api = deviceFetch(SERVER);
const CODE: ShownCode = {
  pairingId: "22222222-2222-4222-8222-222222222222",
  pollSecret: "secret",
  code: "K7MP-4QXR",
  qrUrl: `${SERVER}/pair?code=K7MP-4QXR&profile=child`,
  expiresAt: "2026-11-16T12:15:00.000Z",
};
const NOW = new Date("2026-11-16T12:00:00.000Z");
const PHONE_ID = fixture.phoneId;
const identity = { phoneId: PHONE_ID, deviceToken: "pp_d_token", server: SERVER };

describe("pairing state machine", () => {
  const showing: PairingState = { step: "showing", ...CODE };

  it("goes from a code to paired and stays paired", () => {
    let s = pairingReducer({ step: "idle" }, { type: "start" });
    expect(s).toEqual({ step: "starting" });
    s = pairingReducer(s, { type: "started", code: CODE });
    expect(s).toEqual(showing);
    const waited = pairingReducer(s, { type: "waiting" });
    expect(waited).toEqual(showing);
    expect(waited).not.toBe(s); // a new object, so the screen polls again
    s = pairingReducer(waited, { type: "paired", phoneId: PHONE_ID, deviceToken: "pp_d_token" });
    expect(s).toEqual({ step: "paired", phoneId: PHONE_ID, deviceToken: "pp_d_token" });
    for (const event of [{ type: "expired" }, { type: "start" }] as const) {
      expect(pairingReducer(s, event)).toBe(s);
    }
  });

  it("keeps the code on screen when one poll fails, and offers a new code when it runs out", () => {
    expect(pairingReducer(showing, { type: "failed" })).toBe(showing);
    const expired = pairingReducer(showing, { type: "expired" });
    expect(expired).toEqual({ step: "expired" });
    expect(pairingReducer(expired, { type: "start" })).toEqual({ step: "starting" });
  });

  it("tells 'not yet' apart from a failed start", () => {
    expect(pairingReducer({ step: "starting" }, { type: "notYet" })).toEqual({ step: "notYet" });
    expect(pairingReducer({ step: "starting" }, { type: "failed" })).toEqual({ step: "failed" });
    // A late answer for a start that was cancelled changes nothing.
    expect(pairingReducer({ step: "idle" }, { type: "started", code: CODE })).toEqual({ step: "idle" });
    expect(pairingReducer({ step: "idle" }, { type: "paired", phoneId: PHONE_ID, deviceToken: "x" })).toEqual({ step: "idle" });
  });

  it("asks the server for an iPhone child code", async () => {
    const { calls } = fakeApi({ "POST /device/pairings": { status: 201, body: { ...CODE, platform: "ios", confirmOnPhone: false } } });
    expect(await startPairing(api, { model: "iPhone" })).toEqual({ type: "started", code: CODE });
    expect(calls[0]!.body).toEqual({ platform: "ios", profile: "child", deviceInfo: { model: "iPhone" } });
    expect(calls[0]!.auth).toBeNull();
  });

  it("shows 'not yet' while the server does not pair iPhones", async () => {
    fakeApi({ "POST /device/pairings": { status: 403, body: { error: "not yet", code: "ios_pairing_not_yet" } } });
    expect(await startPairing(api, {})).toEqual({ type: "notYet" });
    fakeApi({ "POST /device/pairings": { status: 429, body: { error: "too many pairings" } } });
    expect(await startPairing(api, {})).toEqual({ type: "failed" });
  });

  it("polls with the secret until the parent claims the code", async () => {
    const path = `GET /device/pairings/${CODE.pairingId}`;
    const { calls } = fakeApi({ [path]: { status: 202, body: { status: "waiting" } } });
    expect(await pollPairing(api, CODE, NOW)).toEqual({ type: "waiting" });
    expect(calls[0]!.headers["x-poll-secret"]).toBe("secret");
    fakeApi({ [path]: { status: 200, body: { status: "paired", phoneId: PHONE_ID, deviceToken: "pp_d_token" } } });
    expect(await pollPairing(api, CODE, NOW)).toEqual({ type: "paired", phoneId: PHONE_ID, deviceToken: "pp_d_token" });
    fakeApi({ [path]: { status: 410, body: { error: "expired" } } });
    expect(await pollPairing(api, CODE, NOW)).toEqual({ type: "expired" });
  });

  it("keeps waiting through a network error, but not past the code's time", async () => {
    globalThis.fetch = (async () => { throw new TypeError("Network request failed"); }) as typeof fetch;
    expect(await pollPairing(api, CODE, NOW)).toEqual({ type: "waiting" });
    expect(await pollPairing(api, CODE, new Date("2026-11-16T12:15:00.000Z"))).toEqual({ type: "expired" });
  });
});

describe("rules sync on an iPhone", () => {
  const rules = (doc: object = fixture, etag = '"r1"') => ({ status: 200, body: doc, headers: { etag } });

  it("applies new rules with the selection and reports the receipt", async () => {
    const screenTime = fakeScreenTime("approved");
    const { calls } = fakeApi({
      "GET /device/rules": rules(),
      "GET /device/ios-selection": { body: { selection: "AAEC", source: "phone", updatedAt: "2026-11-16T12:00:00.000Z" } },
      "PUT /device/status": { status: 204 },
    });
    const r = await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" });
    expect(r).toMatchObject({ outcome: "applied", pollSeconds: 60 });
    expect(screenTime.applied).toEqual([{ document: JSON.stringify(fixture), etag: '"r1"', phoneId: PHONE_ID, selection: "AAEC" }]);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /device/rules", "GET /device/ios-selection", "PUT /device/status"]);
    expect(calls.every((c) => c.auth === "Bearer pp_d_token")).toBe(true);
    expect(calls[2]!.body).toEqual({
      appVersion: "0.2.0",
      batteryPct: null,
      charging: null,
      deviceOwner: false,
      lockIntact: true,
      maintenance: false,
      failedPolicies: [],
      rulesEtag: '"r1"',
      rulesAppliedAt: "2026-11-16T12:00:00Z",
      rulesReceiptConfirmed: true,
      dnsHost: null,
      ios: { iosVersion: "26.1", authorizationStatus: "approved", effectiveStores: ["base"] },
    });
  });

  it("sends the applied ETag and applies nothing on 304, but still reports", async () => {
    const screenTime = fakeScreenTime("approved");
    screenTime.current = { ...screenTime.current, rulesEtag: '"r1"', rulesReceiptConfirmed: true };
    const { calls } = fakeApi({ "GET /device/rules": { status: 304 }, "PUT /device/status": { status: 204 } });
    expect((await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("unchanged");
    expect(calls[0]!.headers["if-none-match"]).toBe('"r1"');
    expect(screenTime.applied).toEqual([]);
    expect(calls.map((c) => c.path)).toEqual(["/device/rules", "/device/status"]);
  });

  it("fetches the selection only when its revision changes", async () => {
    const screenTime = fakeScreenTime("approved");
    const memory = emptyMemory();
    const { calls } = fakeApi({
      "GET /device/rules": rules(),
      "GET /device/ios-selection": { body: { selection: "AAEC", source: "phone", updatedAt: "2026-11-16T12:00:00.000Z" } },
      "PUT /device/status": { status: 204 },
    });
    await syncOnce({ api, identity, screenTime, memory, appVersion: "0.2.0" });
    await syncOnce({ api, identity, screenTime, memory, appVersion: "0.2.0" });
    expect(calls.filter((c) => c.path === "/device/ios-selection")).toHaveLength(1);
    expect(screenTime.applied.map((a) => a.selection)).toEqual(["AAEC", "AAEC"]);
  });

  it("does not apply rules without their selection when the selection cannot be fetched", async () => {
    const screenTime = fakeScreenTime("approved");
    fakeApi({ "GET /device/rules": rules(), "GET /device/ios-selection": { status: 500, body: {} } });
    expect((await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("offline");
    expect(screenTime.applied).toEqual([]);
  });

  it("reports an invalid document instead of claiming it applied", async () => {
    const screenTime = fakeScreenTime("approved");
    const { calls } = fakeApi({
      "GET /device/rules": { status: 200, body: "not a document", headers: { etag: '"r2"' } },
      "PUT /device/status": { status: 204 },
    });
    // The fake answers a JSON string, which the Swift side cannot read as rules.
    screenTime.applyRules = async () => {
      screenTime.current = { ...screenTime.current, failedPolicies: ["rules document unreadable: not a rules document"] };
      return screenTime.current;
    };
    await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" });
    const report = calls.find((c) => c.path === "/device/status")!.body as { failedPolicies: string[]; rulesEtag: string | null };
    expect(report.failedPolicies).toEqual(["rules document unreadable: not a rules document"]);
    expect(report.rulesEtag).toBeNull();
  });

  it("releases, acknowledges and stops when the parents release the phone", async () => {
    const screenTime = fakeScreenTime("approved");
    const { calls } = fakeApi({ "GET /device/rules": rules({ ...fixture, release: true }, '"rel"'), "POST /device/released": { status: 204 } });
    expect((await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("released");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /device/rules", "POST /device/released"]);
  });

  it("acknowledges a release again at the next sync when the first acknowledgement was lost", async () => {
    const screenTime = fakeScreenTime("approved");
    screenTime.current = { ...screenTime.current, released: true };
    fakeApi({ "POST /device/released": { status: 503, body: {} } });
    expect((await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("offline");
    const { calls } = fakeApi({ "POST /device/released": { status: 401, body: { error: "unknown device; pair again" } } });
    expect((await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("released");
    expect(calls.map((c) => c.path)).toEqual(["/device/released"]);
  });

  it("notices when the phone was removed from the dashboard", async () => {
    fakeApi({ "GET /device/rules": { status: 401, body: { error: "unknown device; pair again" } } });
    expect((await syncOnce({ api, identity, screenTime: fakeScreenTime("approved"), memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("unpaired");
  });

  it("retries a 401 from something else in front of the server instead of unpairing", async () => {
    // A proxy or login wall in front of a self-hosted server (docs/sync-api.md, Rules, step 6).
    fakeApi({ "GET /device/rules": { status: 401, body: "<html>Sign in</html>" } });
    expect((await syncOnce({ api, identity, screenTime: fakeScreenTime("approved"), memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("offline");
    fakeApi({ "GET /device/rules": { status: 304 }, "PUT /device/status": { status: 401, body: { error: "unauthorized" } } });
    expect((await syncOnce({ api, identity, screenTime: fakeScreenTime("approved"), memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("unchanged");
    const screenTime = fakeScreenTime("approved");
    screenTime.current = { ...screenTime.current, released: true };
    fakeApi({ "POST /device/released": { status: 401, body: {} } });
    expect((await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("offline");
  });

  it("keeps the server's poll interval when the rules are unchanged", async () => {
    const screenTime = fakeScreenTime("approved");
    const memory = emptyMemory();
    fakeApi({ "GET /device/rules": rules({ ...fixture, pollSeconds: 300 }), "PUT /device/status": { status: 204 } });
    expect(await syncOnce({ api, identity, screenTime, memory, appVersion: "0.2.0" })).toMatchObject({ outcome: "applied", pollSeconds: 300 });
    fakeApi({ "GET /device/rules": { status: 304 }, "PUT /device/status": { status: 204 } });
    expect(await syncOnce({ api, identity, screenTime, memory, appVersion: "0.2.0" })).toMatchObject({ outcome: "unchanged", pollSeconds: 300 });
  });

  it("does not throw when the Swift module cannot answer", async () => {
    const screenTime = fakeScreenTime("approved");
    screenTime.status = async () => {
      throw new Error("no native module");
    };
    const { calls } = fakeApi({});
    expect(await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).toEqual({ outcome: "offline", status: null });
    expect(calls).toEqual([]);
  });

  it("keeps the rules in effect while offline", async () => {
    const screenTime = fakeScreenTime("approved");
    globalThis.fetch = (async () => { throw new TypeError("Network request failed"); }) as typeof fetch;
    expect((await syncOnce({ api, identity, screenTime, memory: emptyMemory(), appVersion: "0.2.0" })).outcome).toBe("offline");
    expect(screenTime.applied).toEqual([]);
  });

  it("reports what the Swift side says, without the fields the server does not take", () => {
    const body = statusBody({ ...fakeScreenTime("denied").current, failedPolicies: ["Screen Time permission is not given"] }, "0.2.0");
    expect(body).not.toHaveProperty("released");
    expect(body).toMatchObject({ lockIntact: false, failedPolicies: ["Screen Time permission is not given"], ios: { authorizationStatus: "denied" } });
  });
});

describe("setup wizard", () => {
  const facts = (over: Partial<WizardFacts> = {}): WizardFacts => ({
    started: false, authorization: "notDetermined", paired: false, appleSettingsAnswered: false, ...over,
  });

  it("walks welcome, permission, pairing, Apple settings and done in that order", () => {
    expect(currentStep(facts())).toBe("welcome");
    expect(currentStep(facts({ started: true }))).toBe("permission");
    expect(currentStep(facts({ started: true, authorization: "approved" }))).toBe("pair");
    expect(currentStep(facts({ started: true, authorization: "approved", paired: true }))).toBe("appleSettings");
    expect(currentStep(facts({ started: true, authorization: "approved", paired: true, appleSettingsAnswered: true }))).toBe("done");
  });

  it("never skips Screen Time permission, also after pairing", () => {
    expect(currentStep(facts({ started: true, authorization: "denied" }))).toBe("permission");
    // Permission withdrawn later: back to the permission step, not to the welcome screen.
    expect(currentStep(facts({ paired: true, authorization: "denied", appleSettingsAnswered: true }))).toBe("permission");
    expect(currentStep(facts({ started: true, authorization: "approvedWithLimits" }))).toBe("permission");
  });

  it("counts the steps between welcome and done", () => {
    expect(progress("welcome")).toBeNull();
    expect(progress("permission")).toEqual({ index: 1, total: 3 });
    expect(progress("appleSettings")).toEqual({ index: 3, total: 3 });
    expect(progress("done")).toBeNull();
  });
});
