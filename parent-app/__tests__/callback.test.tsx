// SPDX-License-Identifier: Apache-2.0
//
// "Ask for a callback": the settings card and the request list, through the real router against a fake API.
// Every number here is synthetic.
import * as SecureStore from "expo-secure-store";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { Linking } from "react-native";
import { routeForPush } from "../src/lib/notifications";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const SOS = `/phones/${PHONE.id}/sos`;
const CB = `/phones/${PHONE.id}/callback-requests`;
const NUMBER = "+4500000001";
const ID = "00000000-0000-4000-8000-000000000009";
const request = (patch: Record<string, unknown> = {}) => ({
  id: ID, state: "sent", createdAt: "2026-11-19T14:32:00Z", expiresAt: "2026-11-20T14:32:00Z",
  doneAt: null, doneVia: null, number: "ok", ...patch,
});

function serve(opts: { settings?: Record<string, unknown>; number?: string | null; requests?: unknown[]; done?: { status: number; body?: unknown } } = {}) {
  const s = { settings: { callbackRequests: false, callbackConfirmed: false, ...opts.settings }, number: opts.number ?? null };
  const api = fakeApi({
    "GET /me": { body: ME },
    "GET /phones": { body: { phones: [PHONE] } },
    [`GET /phones/${PHONE.id}`]: { body: PHONE },
    [`GET /phones/${PHONE.id}/changes`]: { body: { changes: [] } },
    [`GET /phones/${PHONE.id}/apps`]: { body: { apps: [] } },
    [`GET ${SOS}`]: () => ({ body: { events: [], callbackNumber: s.number, settings: s.settings } }),
    [`PUT ${SOS}`]: ({ body }) => {
      const b = body as Record<string, unknown>;
      if ("callbackNumber" in b) s.number = b.callbackNumber as string | null;
      if (b.callbackConfirmed) s.settings.callbackConfirmed = true;
      if ("callbackRequests" in b) s.settings.callbackRequests = b.callbackRequests as boolean;
      return { status: 204 };
    },
    [`GET ${CB}`]: () => ({ body: { callbackNumber: s.number, requests: opts.requests ?? [] } }),
    [`POST ${CB}/${ID}/done`]: opts.done ?? { body: request({ state: "done", doneVia: "number" }) },
    [`GET /phones/${PHONE.id}/quick-messages`]: { body: { messages: [], suggestions: [] } },
    [`GET /phones/${PHONE.id}/home`]: { body: {} },
    [`GET /phones/${PHONE.id}/time-limits`]: { body: { total: null, apps: [], bonuses: [], used: null } },
    [`GET /notifications`]: { body: { mutedPhoneIds: [] } },
    [`GET /phones/${PHONE.id}/more-time-requests`]: { body: { requests: [] } },
  });
  return { api, s };
}

const open = async () => {
  await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
  await fireEvent.press(await screen.findByTestId("callback-settings-toggle"));
};
const sent = (api: ReturnType<typeof fakeApi>, method: string) => api.calls.filter((c) => c.method === method);

beforeEach(async () => {
  await SecureStore.setItemAsync("pp.session", "pp_s_saved");
});

describe("callback settings", () => {
  it("starts off and unusable, with the one-line explanation, until a number is confirmed", async () => {
    serve();
    await open();
    expect(screen.getByTestId("callback-enabled").props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("callback-enabled").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText(/Let this phone ask a parent to call back/)).toBeTruthy();
    expect(screen.getByText("Enter the number and confirm it to turn this on.")).toBeTruthy();
  });

  it("saves the number together with the parent's confirmation, then allows the switch", async () => {
    const { api } = serve();
    await open();
    await fireEvent.changeText(screen.getByTestId("callback-number"), NUMBER);
    // Typing is not enough: the parent has to say it is the phone's number.
    expect(screen.getByTestId("callback-save").props.accessibilityState.disabled).toBe(true);
    await fireEvent(screen.getByTestId("callback-confirm"), "valueChange", true);
    await fireEvent.press(screen.getByTestId("callback-save"));
    await waitFor(() => expect(sent(api, "PUT").map((c) => c.body)).toEqual([{ callbackNumber: NUMBER, callbackConfirmed: true }]));
    await waitFor(() => expect(screen.getByTestId("callback-enabled").props.accessibilityState.disabled).toBeFalsy());
    await fireEvent(screen.getByTestId("callback-enabled"), "valueChange", true);
    await waitFor(() => expect(sent(api, "PUT").at(-1)!.body).toEqual({ callbackRequests: true }));
  });
});

describe("callback requests", () => {
  it("shows the saved number first and opens the dialler only after a tap the server accepted", async () => {
    const open_ = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const { api } = serve({ number: NUMBER, requests: [request()] });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    expect((await screen.findByTestId("callback-number-line")).props.children).toContain(NUMBER);
    expect(open_).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("callback-call"));
    await waitFor(() => expect(open_).toHaveBeenCalledWith(`tel:${NUMBER}`));
    expect(sent(api, "POST").map((c) => c.body)).toContainEqual({ via: "number", number: NUMBER });
    open_.mockRestore();
  });

  it("does not dial when the server refuses a number that changed, and says so", async () => {
    const open_ = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    serve({ number: NUMBER, requests: [request()], done: { status: 409, body: { error: "changed" } } });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    await fireEvent.press(await screen.findByTestId("callback-call"));
    expect(await screen.findByText("The number changed just now. Check it before you call.")).toBeTruthy();
    expect(open_).not.toHaveBeenCalled();
    open_.mockRestore();
  });

  it("says a changed or cleared number is stale, offers no dialling, and still allows calling from own contacts", async () => {
    serve({ number: "+4500000002", requests: [request({ number: "changed" })] });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    expect(await screen.findByText(/The number was changed after this request/)).toBeTruthy();
    expect(screen.queryByTestId("callback-call")).toBeNull();
    expect(screen.queryByTestId("callback-number-line")).toBeNull();
    expect(screen.getByTestId("callback-other")).toBeTruthy();
  });

  it("shows queued, sent and expired differently, and offers no call for an expired one", async () => {
    serve({ number: NUMBER, requests: [request({ id: "a", state: "queued" }), request({ id: "b", state: "expired" })] });
    await renderRouter(routes, { initialUrl: `/phones/${PHONE.id}` });
    expect(await screen.findByText("Waiting. No parent device has been notified yet, so it is only shown here.")).toBeTruthy();
    expect(screen.queryByText(/Expired. Nobody answered/)).toBeNull();
    expect(screen.getAllByTestId("callback-call")).toHaveLength(1);
  });
});

describe("push", () => {
  it("opens the phone for a callback request", () => {
    expect(routeForPush({ type: "callback-request", phoneId: PHONE.id })).toEqual({ pathname: "/phones/[pid]", params: { pid: PHONE.id } });
  });
});
