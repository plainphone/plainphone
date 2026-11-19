// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { byKey, merge, resultOf } from "./more-time";
import { req } from "./more-time-fixtures";


it("names the result of each status", () => {
  expect(resultOf(req())).toBeNull();
  expect(resultOf(req({ status: "approved", answer: "15", grantedMinutes: 15 }))).toEqual({ key: "moreTime.resultApproved", minutes: 15 });
  expect(resultOf(req({ status: "approved", answer: "60", grantedMinutes: 60 }))).toEqual({ key: "moreTime.resultApproved", minutes: 60 });
  expect(resultOf(req({ status: "approved", answer: "day", grantedMinutes: 140 }))).toEqual({ key: "moreTime.resultDay" });
  expect(resultOf(req({ status: "declined", answer: "no" }))).toEqual({ key: "moreTime.resultDeclined" });
  expect(resultOf(req({ status: "expired" }))).toEqual({ key: "moreTime.resultExpired" });
});

it("says who answered, and nothing for open or expired requests", () => {
  expect(byKey(req({ status: "approved", answeredByYou: true }))).toBe("moreTime.byYou");
  expect(byKey(req({ status: "declined", answeredByYou: false }))).toBe("moreTime.byOther");
  expect(byKey(req({ status: "approved", answeredByYou: null }))).toBeNull();
  expect(byKey(req({ status: "approved", answeredByYou: null, decidedVia: "phone" }))).toBe("requests.tagOnPhone");
  expect(byKey(req({ status: "expired", answeredByYou: null }))).toBeNull();
  expect(byKey(req())).toBeNull();
});

it("replaces one request in place and keeps the order", () => {
  const list = [req({ id: "a" }), req({ id: "b" }), req({ id: "c" })];
  const next = merge(list, req({ id: "b", status: "declined", answer: "no", answeredByYou: true }));
  expect(next.map((r) => r.id)).toEqual(["a", "b", "c"]);
  expect(next[1]!.status).toBe("declined");
  expect(next[0]!.status).toBe("pending");
});
