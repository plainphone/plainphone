// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for the Swift module (modules/plainphone-screentime), with the same rules as
// ScreenTimeEngine.swift: a released phone never locks again, and an invalid document keeps the
// old ETag and reports the failure.
import type { Authorization, ScreenTime, ScreenTimeStatus } from "../modules/plainphone-screentime";

export interface FakeScreenTime extends ScreenTime {
  authorization: Authorization;
  /** What `requestAuthorization` answers. */
  answer: Authorization;
  applied: { document: string; etag: string; phoneId: string | null; selection: string | null }[];
  current: ScreenTimeStatus;
}

export function fakeScreenTime(authorization: Authorization = "notDetermined"): FakeScreenTime {
  const fake: FakeScreenTime = {
    authorization,
    answer: "approved",
    applied: [],
    current: {
      lockIntact: false,
      maintenance: false,
      failedPolicies: [],
      rulesEtag: null,
      rulesAppliedAt: null,
      rulesReceiptConfirmed: false,
      released: false,
      ios: { iosVersion: "26.1", authorizationStatus: authorization, effectiveStores: [] },
    },
    async authorizationStatus() {
      return fake.authorization;
    },
    async requestAuthorization() {
      fake.authorization = fake.answer;
      fake.current = { ...fake.current, ios: { ...fake.current.ios, authorizationStatus: fake.answer } };
      if (fake.answer !== "approved") throw new Error("denied");
      return fake.authorization;
    },
    async applyRules(document, etag, phoneId, selection) {
      if (fake.current.released) return fake.current;
      let doc: { phoneId?: string; release?: boolean };
      try {
        doc = JSON.parse(document);
      } catch {
        fake.current = { ...fake.current, failedPolicies: ["rules document unreadable"] };
        return fake.current;
      }
      fake.applied.push({ document, etag, phoneId, selection });
      const released = doc.release === true;
      fake.current = {
        ...fake.current,
        lockIntact: !released && fake.authorization === "approved",
        failedPolicies: [],
        rulesEtag: etag,
        rulesAppliedAt: "2026-11-16T12:00:00Z",
        rulesReceiptConfirmed: true,
        released,
        ios: { ...fake.current.ios, authorizationStatus: fake.authorization, effectiveStores: released ? [] : ["base"] },
      };
      return fake.current;
    },
    async setMaintenance(on) {
      fake.current = { ...fake.current, maintenance: on, lockIntact: !on };
      return fake.current;
    },
    async beginNewPairing() {
      fake.current = { ...fake.current, released: false, rulesEtag: null, rulesAppliedAt: null, rulesReceiptConfirmed: false };
      return fake.current;
    },
    async status() {
      return fake.current;
    },
  };
  return fake;
}
