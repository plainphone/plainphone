// SPDX-License-Identifier: Apache-2.0
//
// Requests for more time on the phone's screen, the two switches next to the screen time rules,
// and the answer buttons on the notification, through the real router against a fake API.
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { act, fireEvent, renderRouter, screen, waitFor, within } from "expo-router/testing-library";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const at = (section = "") => `/phones/${PHONE.id}${section ? `/${section}` : ""}`;
const LIST = `/phones/${PHONE.id}/more-time-requests`;
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function request(n: number, patch: Record<string, unknown> = {}) {
  return {
    id: ID(n), phoneId: PHONE.id, packageName: "com.example.insta", appLabel: "Instagram", reason: null, day: "2026-11-19",
    status: "pending", answer: null, grantedMinutes: null, createdAt: "2026-11-19T14:00:00Z", decidedAt: null, answeredByYou: null,
    ...patch,
  };
}

function phoneApi(extra: Parameters<typeof fakeApi>[0] = {}, phone: Record<string, unknown> = PHONE) {
  return fakeApi({
    "GET /me": { body: ME },
    "GET /phones": { body: { phones: [phone] } },
    [`GET /phones/${PHONE.id}`]: { body: phone },
    [`GET /phones/${PHONE.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${PHONE.id}/apps`]: { body: { apps: [] } },
    [`GET /phones/${PHONE.id}/sos`]: { body: { events: [], callbackNumber: null } },
    [`GET /phones/${PHONE.id}/home`]: { body: {} },
    [`GET /phones/${PHONE.id}/time-limits`]: { body: { total: null, apps: [], bonuses: [], used: null } },
    [`GET /notifications`]: { body: { mutedPhoneIds: [] } },
    ...extra,
  });
}

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("requests on the phone's screen", () => {
  it("shows an open request with its reason and four answers", async () => {
    phoneApi({ [`GET ${LIST}`]: { body: { requests: [request(1, { reason: "Homework video" }), request(2, { packageName: "*", appLabel: null })] } } });
    await renderRouter(routes, { initialUrl: at() });
    expect(await screen.findByText("Alma asks for more time on Instagram")).toBeTruthy();
    expect(screen.getByText("Alma asks for more time on the daily limit")).toBeTruthy();
    expect(screen.getByText(/“Homework video”/)).toBeTruthy();
    const first = within(screen.getByTestId(`more-time-${ID(1)}`));
    for (const label of ["15 min", "1 hour", "Rest of the day", "No"]) {
      expect(first.getByLabelText(`${label}: Alma asks for more time on Instagram`)).toBeTruthy();
    }
  });

  it("shows nothing without requests, and nothing when the server does not know the list", async () => {
    phoneApi({ [`GET ${LIST}`]: { status: 404, body: { error: "not found" } } });
    await renderRouter(routes, { initialUrl: at() });
    expect(await screen.findByTestId("phone-overview")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("more-time")).toBeNull());
  });

  it("sends the answer and shows the result in place", async () => {
    let answered = false;
    const api = phoneApi({
      [`GET ${LIST}`]: { body: { requests: [request(1)] } },
      [`POST ${LIST}/${ID(1)}/answer`]: () => {
        answered = true;
        return { body: request(1, { status: "approved", answer: "15", grantedMinutes: 15, decidedAt: "2026-11-19T14:01:00Z", won: true, answeredByYou: true }) };
      },
    });
    await renderRouter(routes, { initialUrl: at() });
    await fireEvent.press(await screen.findByTestId(`more-time-${ID(1)}-15`));
    expect(await screen.findByText("15 more minutes given. Answered by you")).toBeTruthy();
    expect(answered).toBe(true);
    expect(screen.queryByTestId(`more-time-${ID(1)}`)).toBeNull();
    expect(screen.queryByText("This was already answered.")).toBeNull();
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ answer: "15" });
  });

  it.each([
    ["day", { status: "approved", answer: "day", grantedMinutes: 300 }, "Given the rest of the day. Answered by you"],
    ["no", { status: "declined", answer: "no" }, "Declined. Answered by you"],
    ["60", { status: "approved", answer: "60", grantedMinutes: 60 }, "60 more minutes given. Answered by you"],
  ])("sends %s", async (answer, patch, text) => {
    const api = phoneApi({
      [`GET ${LIST}`]: { body: { requests: [request(1)] } },
      [`POST ${LIST}/${ID(1)}/answer`]: { body: request(1, { ...patch, won: true, answeredByYou: true }) },
    });
    await renderRouter(routes, { initialUrl: at() });
    await fireEvent.press(await screen.findByTestId(`more-time-${ID(1)}-${answer}`));
    expect(await screen.findByText(text)).toBeTruthy();
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ answer });
  });

  it("says so, calmly, when someone else answered first", async () => {
    phoneApi({
      [`GET ${LIST}`]: { body: { requests: [request(1)] } },
      [`POST ${LIST}/${ID(1)}/answer`]: { body: request(1, { status: "declined", answer: "no", won: false, answeredByYou: false }) },
    });
    await renderRouter(routes, { initialUrl: at() });
    await fireEvent.press(await screen.findByTestId(`more-time-${ID(1)}-60`));
    expect(await screen.findByText("Declined. Answered by another parent")).toBeTruthy();
    expect(screen.getByText("This was already answered.")).toBeTruthy();
  });

  it("shows answered, expired and daily cap requests as quiet rows without buttons", async () => {
    phoneApi({
      [`GET ${LIST}`]: {
        body: {
          requests: [
            request(1, { status: "approved", answer: "15", grantedMinutes: 15, answeredByYou: false }),
            request(2, { status: "expired" }),
            request(3, { packageName: "*", appLabel: null, status: "approved", answer: "day", grantedMinutes: 200, answeredByYou: true }),
          ],
        },
      },
    });
    await renderRouter(routes, { initialUrl: at() });
    expect(await screen.findByText("15 more minutes given. Answered by another parent")).toBeTruthy();
    expect(screen.getByText("Expired, nobody answered before midnight")).toBeTruthy();
    expect(screen.getByText("Given the rest of the day. Answered by you")).toBeTruthy();
    expect(screen.getByText("Alma asks for more time on the daily limit")).toBeTruthy();
    expect(screen.queryByText("No")).toBeNull();
    expect(screen.getAllByTestId(/^more-time-done-/)).toHaveLength(3);
  });

  it("says the answer could not be sent, and keeps the buttons", async () => {
    phoneApi({
      [`GET ${LIST}`]: { body: { requests: [request(1)] } },
      [`POST ${LIST}/${ID(1)}/answer`]: { status: 500, body: { error: "boom" } },
    });
    await renderRouter(routes, { initialUrl: at() });
    await fireEvent.press(await screen.findByTestId(`more-time-${ID(1)}-15`));
    expect(await screen.findByText("The answer could not be sent. Try again.")).toBeTruthy();
    expect(screen.getByTestId(`more-time-${ID(1)}-15`)).toBeTruthy();
  });

  it("is left out for a phone that is not a child's", async () => {
    const own = { ...PHONE, profile: "self" };
    const api = phoneApi({}, own);
    await renderRouter(routes, { initialUrl: at() });
    expect(await screen.findByTestId("phone-overview")).toBeTruthy();
    expect(api.calls.some((c) => c.path === LIST)).toBe(false);
  });

  it("shows the number of open requests on the start screen", async () => {
    phoneApi({}, { ...PHONE, openMoreTimeRequests: 2 });
    await renderRouter(routes, { initialUrl: "/" });
    expect(await screen.findByLabelText(/2 requests/)).toBeTruthy();
  });
});

describe("switches next to the screen time rules", () => {
  it("shows both on when the server does not send them", async () => {
    phoneApi();
    await renderRouter(routes, { initialUrl: at("time") });
    const ask = await screen.findByTestId("time-ask-switch");
    expect(ask.props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("time-warn-switch").props.accessibilityState.checked).toBe(true);
    expect(screen.getByText("Allow asking for more time")).toBeTruthy();
    expect(screen.getByText("Warn 5 minutes before")).toBeTruthy();
  });

  it.each([
    ["time-ask-switch", "askMoreTimeEnabled"],
    ["time-warn-switch", "limitWarningEnabled"],
  ])("%s saves %s and shows the saved value", async (testID, field) => {
    const api = phoneApi({
      [`PATCH /phones/${PHONE.id}`]: ({ body }) => ({ body: { ...PHONE, ...(body as object) } }),
    });
    await renderRouter(routes, { initialUrl: at("time") });
    await fireEvent.press(await screen.findByTestId(testID));
    await waitFor(() => expect(screen.getByTestId(testID).props.accessibilityState.checked).toBe(false));
    const patch = api.calls.filter((c) => c.method === "PATCH");
    expect(patch).toHaveLength(1);
    expect(patch[0]!.body).toEqual({ [field]: false });
    // The other one is untouched.
    const other = testID === "time-ask-switch" ? "time-warn-switch" : "time-ask-switch";
    expect(screen.getByTestId(other).props.accessibilityState.checked).toBe(true);
  });

  it("shows a switch that is off on the server as off", async () => {
    phoneApi({}, { ...PHONE, askMoreTimeEnabled: false, limitWarningEnabled: true });
    await renderRouter(routes, { initialUrl: at("time") });
    expect((await screen.findByTestId("time-ask-switch")).props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("time-warn-switch").props.accessibilityState.checked).toBe(true);
  });

  it("is not shown for a phone that is not a child's", async () => {
    phoneApi({}, { ...PHONE, profile: "self" });
    await renderRouter(routes, { initialUrl: at("time") });
    expect(await screen.findByTestId("phone-time")).toBeTruthy();
    expect(screen.queryByTestId("time-ask-switch")).toBeNull();
  });
});

describe("answer button on the notification, with the app running", () => {
  const data = { type: "more-time", phoneId: PHONE.id, requestId: ID(1), url: at() };
  const press = (action: string) => ({
    actionIdentifier: action,
    notification: { date: 1, request: { identifier: "n1", content: { data } } },
  });
  const listener = () => {
    const calls = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls;
    return calls[calls.length - 1]![0];
  };

  it("answers and stays where it is", async () => {
    const api = phoneApi({ [`POST ${LIST}/${ID(1)}/answer`]: { body: { ...request(1), status: "approved", answer: "60", won: true, answeredByYou: true } } });
    await renderRouter(routes, { initialUrl: "/settings" });
    await screen.findByTestId("logout");
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    await act(async () => { listener()(press("60") as never); });
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ answer: "60" });
    expect(screen).toHavePathname("/settings");
  });

  it("opens the phone when the answer fails", async () => {
    phoneApi({ [`POST ${LIST}/${ID(1)}/answer`]: { status: 409, body: { error: "limit removed" } }, [`GET ${LIST}`]: { body: { requests: [] } } });
    await renderRouter(routes, { initialUrl: "/settings" });
    await screen.findByTestId("logout");
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    await act(async () => { listener()(press("no") as never); });
    await waitFor(() => expect(screen).toHavePathname(at()));
  });

  it("answers a button pressed before the app started, once the sign-in is loaded", async () => {
    (Linking.getInitialURL as jest.Mock).mockResolvedValue(null);
    const api = phoneApi({ [`POST ${LIST}/${ID(1)}/answer`]: { body: { ...request(1), status: "declined", answer: "no", won: true, answeredByYou: true } } });
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValueOnce({ ...press("no"), notification: { date: 2, request: { identifier: "n-cold", content: { data } } } } as never);
    await renderRouter(routes, { initialUrl: "/settings" });
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST")).toBe(true));
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.auth).toBe("Bearer pp_s_saved");
    expect(post.body).toEqual({ answer: "no" });
  });
});
