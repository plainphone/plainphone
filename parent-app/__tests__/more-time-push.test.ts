// SPDX-License-Identifier: Apache-2.0
//
// The answer buttons on a "more time" notification: the category with its four localized actions,
// and what a button press or a tap does.
import * as Notifications from "expo-notifications";
import { setSessionToken } from "../src/api/client";
import type { Locale } from "../src/api/models";
import { ensureCategories, handleNotificationResponse, MORE_TIME_CATEGORY, routeForPush, syncNativePush, watchNativePush } from "../src/lib/notifications";
import { moreTimeTarget } from "../src/lib/moreTime";
import { fakeApi } from "../test/fakeApi";
import { makeAppT } from "../src/i18n/I18n";

const T = makeAppT("en");

const PID = "11111111-1111-4111-8111-111111111111";
const RID = "33333333-3333-4333-8333-333333333333";
const DATA = { type: "more-time", phoneId: PID, requestId: RID, url: `/phones/${PID}`, urgent: "false" };

function response(actionIdentifier: string, data: Record<string, unknown> = DATA, identifier = "notification-1") {
  return {
    actionIdentifier,
    notification: { date: 1, request: { identifier, content: { data } } },
  } as unknown as Notifications.NotificationResponse;
}

const ANSWER_PATH = `/phones/${PID}/more-time-requests/${RID}/answer`;
const WON = { id: RID, status: "approved", answer: "15", grantedMinutes: 15, won: true, answeredByYou: true };

afterEach(() => {
  jest.clearAllMocks();
  setSessionToken(null);
});

describe("category", () => {
  const TITLES: Record<Locale, string[]> = {
    en: ["15 min", "1 hour", "Rest of the day", "No"],
    da: ["15 min", "1 time", "Resten af dagen", "Nej"],
    sv: ["15 min", "1 timme", "Resten av dagen", "Nej"],
    nb: ["15 min", "1 time", "Resten av dagen", "Nei"],
    de: ["15 Min.", "1 Stunde", "Rest des Tages", "Nein"],
  };

  it.each(Object.keys(TITLES) as Locale[])("registers four actions answered by the API, titled in %s", async (locale) => {
    await ensureCategories(locale);
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    const [id, actions] = jest.mocked(Notifications.setNotificationCategoryAsync).mock.calls[0]!;
    expect(id).toBe("more-time");
    expect(MORE_TIME_CATEGORY).toBe("more-time");
    expect(actions.map((a) => a.identifier)).toEqual(["15", "60", "day", "no"]);
    expect(actions.map((a) => a.buttonTitle)).toEqual(TITLES[locale]);
    // The answer is sent from the notification; the app does not have to open.
    expect(actions.every((a) => a.options?.opensAppToForeground === true)).toBe(true); // the answer is sent from the app, so it has to open
  });

  it("is registered after login and again when the language changes", async () => {
    fakeApi({});
    setSessionToken("pp_s_test");
    await syncNativePush("en");
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    const stop = watchNativePush("da");
    await Promise.resolve();
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(2);
    expect(jest.mocked(Notifications.setNotificationCategoryAsync).mock.calls[1]![1]![1]!.buttonTitle).toBe("1 time");
    stop();
  });

  it("does not break the push setup when the category cannot be registered", async () => {
    jest.mocked(Notifications.setNotificationCategoryAsync).mockRejectedValueOnce(new Error("no"));
    await expect(ensureCategories("en")).resolves.toBeUndefined();
  });
});

describe("routing", () => {
  it("opens the phone for a request for more time", () => {
    expect(routeForPush({ type: "more-time", phoneId: PID, requestId: RID })).toEqual({ pathname: "/phones/[pid]", params: { pid: PID } });
    expect(routeForPush({ type: "more-time", url: `/phones/${PID}` })).toEqual({ pathname: "/phones/[pid]", params: { pid: PID } });
  });
  it("does not follow a malformed phone id", () => {
    expect(routeForPush({ type: "more-time", phoneId: "../../settings" })).toBe("/");
  });
  it("reads the target only from a well-formed payload", () => {
    expect(moreTimeTarget(DATA)).toEqual({ phoneId: PID, requestId: RID });
    expect(moreTimeTarget({ ...DATA, requestId: "x/../y" })).toBeNull();
    expect(moreTimeTarget({ ...DATA, phoneId: undefined })).toBeNull();
    expect(moreTimeTarget({ ...DATA, type: "approval" })).toBeNull();
    expect(moreTimeTarget(undefined)).toBeNull();
  });
});

describe("answer buttons", () => {
  it.each(["15", "60", "day", "no"])("sends %s without opening anything, then clears the notification", async (action) => {
    const api = fakeApi({ [`POST ${ANSWER_PATH}`]: { body: WON } });
    setSessionToken("pp_s_test");
    expect(await handleNotificationResponse(response(action), true, T)).toBeNull();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: "POST", path: ANSWER_PATH, auth: "Bearer pp_s_test", body: { answer: action, source: "notification" } });
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("notification-1");
  });

  const followUpShown = () => jest.mocked(Notifications.scheduleNotificationAsync).mock.calls.map(([r]) => r);

  it("follows up under the request's tag: what was answered, and that the phone will confirm", async () => {
    fakeApi({ [`POST ${ANSWER_PATH}`]: { body: WON } });
    setSessionToken("pp_s_test");
    await handleNotificationResponse(response("15", { ...DATA, phoneName: "Alma" }), true, T);
    expect(followUpShown()).toEqual([expect.objectContaining({
      identifier: "moretime-33333333333343338333333333333333",
      trigger: { channelId: "quiet" },
      content: expect.objectContaining({ interruptionLevel: "passive", title: "Alma", body: "15 more minutes given. The phone will confirm when it is active.", data: expect.objectContaining({ type: "more-time-done" }) }),
    })]);
  });

  it("does not promise a confirmation for a decline, or when the phone sends no receipts", async () => {
    fakeApi({ [`POST ${ANSWER_PATH}`]: { body: { ...WON, status: "declined", answer: "no", grantedMinutes: null } } });
    setSessionToken("pp_s_test");
    await handleNotificationResponse(response("no"), true, T);
    expect(followUpShown()[0]!.content.body).toBe("Declined");
    fakeApi({ [`POST ${ANSWER_PATH}`]: { body: WON } });
    await handleNotificationResponse(response("15", { ...DATA, receipts: "false" }), true, T);
    expect(followUpShown()[1]!.content.body).toBe("15 more minutes given");
  });

  it("shows the other parent's answer, not an error, when they were first", async () => {
    fakeApi({ [`POST ${ANSWER_PATH}`]: { body: { ...WON, answer: "60", grantedMinutes: 60, won: false, answeredByYou: false } } });
    setSessionToken("pp_s_test");
    expect(await handleNotificationResponse(response("15"), true, T)).toBeNull();
    expect(followUpShown()[0]!.content.body).toBe("Already answered by another parent: 60 more minutes given");
  });

  it("says so in plain words when the request had expired, and opens the phone", async () => {
    fakeApi({ [`POST ${ANSWER_PATH}`]: { body: { ...WON, status: "expired", answer: null, grantedMinutes: null, won: false, answeredByYou: false } } });
    setSessionToken("pp_s_test");
    expect(await handleNotificationResponse(response("15"), true, T)).toEqual({ pathname: "/phones/[pid]", params: { pid: PID } });
    expect(followUpShown()[0]!.content).toMatchObject({ body: "This request had expired", data: { type: "more-time-failed" } });
    expect(followUpShown()[0]!.trigger).toEqual({ channelId: "normal" });
    expect(followUpShown()[0]!.content).not.toHaveProperty("interruptionLevel");
  });

  it("ignores a button on a payload that is not a request, or has a bad id", async () => {
    const api = fakeApi({});
    setSessionToken("pp_s_test");
    expect(await handleNotificationResponse(response("15", { type: "approval", phoneId: PID }), true, T)).toBeNull();
    expect(await handleNotificationResponse(response("15", { ...DATA, requestId: "../x" }), true, T)).toBeNull();
    expect(await handleNotificationResponse(response("15", { ...DATA, phoneId: "nope" }), true, T)).toBeNull();
    expect(await handleNotificationResponse(response("15", {}), true, T)).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it("says it could not answer, and opens the phone, when the answer fails", async () => {
    fakeApi({ [`POST ${ANSWER_PATH}`]: { status: 409, body: { error: "limit removed" } } });
    setSessionToken("pp_s_test");
    expect(await handleNotificationResponse(response("15"), true, T)).toEqual({ pathname: "/phones/[pid]", params: { pid: PID } });
    expect(followUpShown()[0]!.content.body).toBe("Could not answer, open Plainphone");
  });

  it("says it could not answer, and opens the phone, when the network is down", async () => {
    globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
    setSessionToken("pp_s_test");
    expect(await handleNotificationResponse(response("day"), true, T)).toEqual({ pathname: "/phones/[pid]", params: { pid: PID } });
    expect(followUpShown()[0]!.content.body).toBe("Could not answer, open Plainphone");
  });

  it("opens the phone instead of answering when nobody is signed in", async () => {
    const api = fakeApi({});
    expect(await handleNotificationResponse(response("15"), false, T)).toEqual({ pathname: "/phones/[pid]", params: { pid: PID } });
    expect(api.calls).toHaveLength(0);
  });

  it("opens the phone on a plain tap", async () => {
    const api = fakeApi({});
    setSessionToken("pp_s_test");
    const tap = response("expo.modules.notifications.actions.DEFAULT");
    expect(await handleNotificationResponse(tap, true, T)).toEqual({ pathname: "/phones/[pid]", params: { pid: PID } });
    expect(api.calls).toHaveLength(0);
  });
});
