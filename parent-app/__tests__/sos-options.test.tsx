// SPDX-License-Identifier: Apache-2.0
//
// Hidden SOS switches, quick messages and the SOS history label, through the real router against a
// fake API.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { routeForPush } from "../src/lib/notifications";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const SOS = `/phones/${PHONE.id}/sos`;
const QM = `/phones/${PHONE.id}/quick-messages`;
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const message = (n: number, text: string, meansSos = false) => ({ id: ID(n), text, meansSos, createdAt: "2026-11-19T10:00:00Z" });
const suggestion = (n: number, text: string) => ({ id: ID(n), text, createdAt: "2026-11-19T10:00:00Z" });

interface State {
  settings: Record<string, unknown>;
  events: unknown[];
  messages: ReturnType<typeof message>[];
  suggestions: ReturnType<typeof suggestion>[];
}

function serve(state: Partial<State> = {}, extra: Parameters<typeof fakeApi>[0] = {}) {
  const s: State = { settings: {}, events: [], messages: [], suggestions: [], ...state };
  const api = fakeApi({
    "GET /me": { body: ME },
    "GET /phones": { body: { phones: [PHONE] } },
    [`GET /phones/${PHONE.id}`]: { body: PHONE },
    [`GET /phones/${PHONE.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${PHONE.id}/apps`]: { body: { apps: [] } },
    [`GET ${SOS}`]: () => ({ body: { events: s.events, callbackNumber: null, settings: s.settings } }),
    [`PUT ${SOS}`]: ({ body }) => {
      Object.assign(s.settings, body);
      return { status: 204 };
    },
    [`GET ${QM}`]: () => ({ body: { messages: s.messages, suggestions: s.suggestions } }),
    [`GET /phones/${PHONE.id}/home`]: { body: {} },
    [`GET /phones/${PHONE.id}/time-limits`]: { body: { total: null, apps: [], bonuses: [], used: null } },
    [`GET /notifications`]: { body: { mutedPhoneIds: [] } },
    [`GET /phones/${PHONE.id}/more-time-requests`]: { body: { requests: [] } },
    ...extra,
  });
  return { api, s };
}

const open = async (testID: string) => {
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
  await fireEvent.press(await screen.findByTestId(testID));
};
const checked = (testID: string) => screen.getByTestId(testID).props.accessibilityState.checked;
const sent = (api: ReturnType<typeof fakeApi>, method: string) => api.calls.filter((c) => c.method === method);

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("hidden SOS", () => {
  it("starts off, with a one-line explanation, and says the child can see what is on", async () => {
    serve();
    await open("hidden-sos-toggle");
    expect(checked("hidden-power")).toBe(false);
    expect(checked("hidden-clock")).toBe(false);
    expect(screen.getByText("Power button")).toBeTruthy();
    expect(screen.getByText("Your child can see on their phone which hidden options are on.")).toBeTruthy();
    // Choices that only matter once a hidden option is on stay out of sight.
    expect(screen.queryByTestId("hidden-presses")).toBeNull();
    expect(screen.queryByTestId("hidden-feedback")).toBeNull();
  });

  it("saves the power button and the clock with their own PUT bodies", async () => {
    const { api } = serve();
    await open("hidden-sos-toggle");
    await fireEvent.press(screen.getByTestId("hidden-power"));
    await waitFor(() => expect(checked("hidden-power")).toBe(true));
    await fireEvent.press(screen.getByTestId("hidden-clock"));
    await waitFor(() => expect(checked("hidden-clock")).toBe(true));
    expect(sent(api, "PUT").map((c) => c.body)).toEqual([{ hiddenPower: true }, { hiddenClock: true }]);
  });

  it("offers 3 to 6 presses with 4 chosen and the Android 12 note, and saves a change", async () => {
    const { api } = serve({ settings: { hiddenPower: true } });
    await open("hidden-sos-toggle");
    for (const n of [3, 4, 5, 6]) expect(screen.getByTestId(`hidden-presses-${n}`)).toBeTruthy();
    expect(screen.getByTestId("hidden-presses-4").props.accessibilityState.checked).toBe(true);
    expect(screen.getByText(/Android 12 and later can call 112 by itself after 5 presses/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("hidden-presses-5"));
    await waitFor(() => expect(sent(api, "PUT").at(-1)!.body).toEqual({ hiddenPresses: 5 }));
    await waitFor(() => expect(screen.getByTestId("hidden-presses-5").props.accessibilityState.checked).toBe(true));
  });

  it("shows the quiet confirmation only while a hidden option is on, and saves it", async () => {
    const { api } = serve({ settings: { hiddenClock: true } });
    await open("hidden-sos-toggle");
    expect(screen.getByTestId("hidden-feedback-vibrate").props.accessibilityState.checked).toBe(true);
    await fireEvent.press(screen.getByTestId("hidden-feedback-none"));
    await waitFor(() => expect(sent(api, "PUT").at(-1)!.body).toEqual({ hiddenFeedback: "none" }));
    await fireEvent.press(screen.getByTestId("hidden-clock"));
    await waitFor(() => expect(screen.queryByTestId("hidden-feedback")).toBeNull());
  });

  it("tells the parent when saving fails and keeps the old value", async () => {
    serve({}, { [`PUT ${SOS}`]: { status: 500, body: { error: "boom" } } });
    await open("hidden-sos-toggle");
    await fireEvent.press(screen.getByTestId("hidden-power"));
    expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
    expect(checked("hidden-power")).toBe(false);
  });
});

describe("quick messages", () => {
  it("starts with quick messages off (suggestions on for when they are) and saves both", async () => {
    const { api } = serve();
    await open("quick-messages-toggle");
    expect(checked("qm-enabled")).toBe(false);
    expect(checked("qm-suggest")).toBe(true);
    await fireEvent.press(screen.getByTestId("qm-enabled"));
    await waitFor(() => expect(checked("qm-enabled")).toBe(true));
    await fireEvent.press(screen.getByTestId("qm-suggest"));
    await waitFor(() => expect(checked("qm-suggest")).toBe(false));
    expect(sent(api, "PUT").map((c) => c.body)).toEqual([{ quickMessagesEnabled: true }, { quickSuggestionsEnabled: false }]);
  });

  it("offers the three starters while the list is empty and adds one with one tap", async () => {
    const { api } = serve({}, {
      [`POST ${QM}`]: ({ body }) => ({ status: 201, body: { ...message(1, (body as { text: string }).text), createdAt: "2026-11-19T10:00:00Z" } }),
    });
    await open("quick-messages-toggle");
    for (const text of ["Pick me up", "I’m okay", "Call me"]) expect(screen.getByText(text)).toBeTruthy();
    await fireEvent.press(screen.getByText("Call me"));
    await waitFor(() => expect(sent(api, "POST")).toHaveLength(1));
    expect(sent(api, "POST")[0]).toMatchObject({ path: QM, body: { text: "Call me", meansSos: false } });
  });

  it("adds a code word with the explanation next to the switch", async () => {
    const { api } = serve({}, { [`POST ${QM}`]: { status: 201, body: message(1, "Pizza tonight?", true) } });
    await open("quick-messages-toggle");
    expect(screen.getByText("Your child’s phone shows an ordinary message. You get an urgent SOS with position.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("qm-new-text"), "  Pizza tonight?  ");
    await fireEvent.press(screen.getByTestId("qm-new-code"));
    await fireEvent.press(screen.getByTestId("qm-new-submit"));
    await waitFor(() => expect(sent(api, "POST")).toHaveLength(1));
    expect(sent(api, "POST")[0]!.body).toEqual({ text: "Pizza tonight?", meansSos: true });
  });

  it("lists messages with code words marked, edits one and deletes another", async () => {
    const { api, s } = serve({ messages: [message(1, "Pick me up"), message(2, "Pizza tonight?", true)] }, {
      [`PATCH ${QM}/${ID(1)}`]: ({ body }) => ({ body: { ...message(1, ""), ...(body as object) } }),
      [`DELETE ${QM}/${ID(2)}`]: () => ({ status: 204 }),
    });
    await open("quick-messages-toggle");
    expect(screen.getByText("Pizza tonight? (Code word)")).toBeTruthy();
    expect(screen.queryByText("Call me")).toBeNull();
    await fireEvent.press(screen.getByTestId(`qm-edit-button-${ID(1)}`));
    await fireEvent.changeText(screen.getByTestId(`qm-edit-${ID(1)}-text`), "Pick me up at 5");
    await fireEvent.press(screen.getByTestId(`qm-edit-${ID(1)}-code`));
    await fireEvent.press(screen.getByTestId(`qm-edit-${ID(1)}-submit`));
    await waitFor(() => expect(sent(api, "PATCH")).toHaveLength(1));
    expect(sent(api, "PATCH")[0]).toMatchObject({ path: `${QM}/${ID(1)}`, body: { text: "Pick me up at 5", meansSos: true } });
    s.messages = [message(2, "Pizza tonight?", true)];
    await fireEvent.press(await screen.findByTestId(`qm-delete-${ID(2)}`));
    await waitFor(() => expect(sent(api, "DELETE")).toHaveLength(1));
    expect(sent(api, "DELETE")[0]!.path).toBe(`${QM}/${ID(2)}`);
  });

  it("stops offering to add at six messages", async () => {
    serve({ messages: [1, 2, 3, 4, 5, 6].map((n) => message(n, `Message ${n}`)) });
    await open("quick-messages-toggle");
    expect(screen.getByText("Message 6")).toBeTruthy();
    expect(screen.queryByTestId("qm-new-text")).toBeNull();
    expect(screen.getByText("Up to 6 messages, 60 characters each.")).toBeTruthy();
  });

  it("opens itself for a suggestion and approves, approves as code word or declines", async () => {
    const { api } = serve({ suggestions: [suggestion(1, "Idea one"), suggestion(2, "Idea two"), suggestion(3, "Idea three")] }, {
      [`POST ${QM}/${ID(1)}/approve`]: { body: message(1, "Idea one") },
      [`POST ${QM}/${ID(2)}/approve`]: { body: message(2, "Idea two", true) },
      [`POST ${QM}/${ID(3)}/decline`]: { status: 204 },
    });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    expect(await screen.findByText("Quick messages (3)")).toBeTruthy();
    expect(await screen.findByText("Suggested by your child")).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`qm-approve-${ID(1)}`));
    await waitFor(() => expect(sent(api, "POST")).toHaveLength(1));
    await fireEvent.press(screen.getByTestId(`qm-approve-code-${ID(2)}`));
    await waitFor(() => expect(sent(api, "POST")).toHaveLength(2));
    await fireEvent.press(screen.getByTestId(`qm-decline-${ID(3)}`));
    await waitFor(() => expect(sent(api, "POST")).toHaveLength(3));
    expect(sent(api, "POST").map((c) => [c.path, c.body])).toEqual([
      [`${QM}/${ID(1)}/approve`, { meansSos: false }],
      [`${QM}/${ID(2)}/approve`, { meansSos: true }],
      [`${QM}/${ID(3)}/decline`, undefined],
    ]);
  });

  it("says so when six messages already exist on approval", async () => {
    serve({ suggestions: [suggestion(1, "Idea one")] }, { [`POST ${QM}/${ID(1)}/approve`]: { status: 409, body: { error: "full" } } });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    await fireEvent.press(await screen.findByTestId(`qm-approve-${ID(1)}`));
    expect(await screen.findByText("You already have 6 messages. Delete one first.")).toBeTruthy();
  });
});

describe("SOS history", () => {
  const event = (id: string, extra: Record<string, unknown>) => ({
    id, kind: "urgent", createdAt: "2026-11-19T14:32:00Z", seenAt: "2026-11-19T14:40:00Z", location: null, ...extra,
  });

  it("says how a hidden SOS was sent, and nothing for the SOS screen", async () => {
    serve({ events: [
      event("a", { trigger: "power" }),
      event("b", { trigger: "clock" }),
      event("c", { trigger: "code", message: "Pizza tonight?" }),
      event("d", { trigger: null, message: null }),
    ] });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    await fireEvent.press(await screen.findByText("SOS history"));
    expect(await screen.findByText("Power button")).toBeTruthy();
    expect(screen.getByText("Clock")).toBeTruthy();
    expect(screen.getByText("Code word «Pizza tonight?»")).toBeTruthy();
    expect(screen.getAllByTestId("sos-trigger")).toHaveLength(3);
    expect(screen.getAllByTestId("sos-history-event")).toHaveLength(4);
  });
});

describe("push", () => {
  it("opens the phone for a quick message and a suggestion", () => {
    const target = { pathname: "/phones/[pid]", params: { pid: PHONE.id } };
    expect(routeForPush({ type: "quick-message", phoneId: PHONE.id })).toEqual(target);
    expect(routeForPush({ type: "quick-suggestion", phoneId: PHONE.id })).toEqual(target);
    expect(routeForPush({ type: "quick-message", phoneId: "../../settings" })).toBe("/");
    expect(routeForPush({ type: "check-in", phoneId: PHONE.id })).toEqual(target);
  });
});

describe("family inbox", () => {
  const INBOX = `/phones/${PHONE.id}/inbox`;
  const thread = {
    familyInbox: true, quickMessages: false, checkIns: true, recipients: ["Alex"],
    messages: [
      { id: ID(1), from: "child", kind: "checkin", text: "Jeg er hjemme", sentAt: "2026-11-19T15:00:00Z", delivered: 1 },
      { id: ID(2), from: "parent", kind: "reply", text: "On my way", sentAt: "2026-11-19T15:01:00Z", author: "Alex", receivedAt: "2026-11-19T15:02:00Z" },
    ],
  };

  it("starts with every switch off and no thread", async () => {
    const { api } = serve();
    await open("family-inbox-toggle");
    expect(checked("inbox-enabled")).toBe(false);
    expect(checked("inbox-check-ins")).toBe(false);
    expect(screen.queryByTestId("inbox-reply")).toBeNull();
    await fireEvent.press(screen.getByTestId("inbox-enabled"));
    await waitFor(() => expect(checked("inbox-enabled")).toBe(true));
    expect(sent(api, "PUT").map((c) => c.body)).toEqual([{ familyInbox: true }]);
  });

  it("shows the thread in the parent's language and sends a short reply", async () => {
    const { api } = serve({ settings: { familyInbox: true, checkIns: true } }, {
      [`GET ${INBOX}`]: { body: thread },
      [`POST ${INBOX}`]: ({ body }) => ({ status: 201, body: { id: ID(3), from: "parent", kind: "reply", sentAt: "2026-11-19T15:05:00Z", ...(body as object) } }),
    });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    expect(await screen.findByText("I’m home")).toBeTruthy();
    expect(screen.getByText("On my way")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("inbox-reply"), "Dinner at 18");
    await fireEvent.press(screen.getByTestId("inbox-send"));
    await waitFor(() => expect(sent(api, "POST")).toHaveLength(1));
    expect(sent(api, "POST")[0]).toMatchObject({ path: INBOX, body: { text: "Dinner at 18" } });
  });
});
