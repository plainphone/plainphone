// SPDX-License-Identifier: Apache-2.0
//
// Who is signed in: links that would sign the app into someone else's account, logouts the
// server never heard about, and the household members a parent can remove.
import { AccessibilityInfo, AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import { retryPendingLogouts } from "../src/lib/pending-logout";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";
const HOSTED = "https://app.plainphone.org";
const openLink = (token: string) => (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(`${HOSTED}/auth/app#token=${token}`);

describe("login links", () => {
  it("asks before using a link the app did not ask for", async () => {
    openLink("pp_m_strangerlink1");
    const api = fakeApi({
      "POST /auth/verify": { body: { user: ME.user, sessionToken: "pp_s_session" } },
      "GET /me": { body: ME },
      "GET /phones": { body: { phones: [PHONE] } },
    });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    expect(await screen.findByText("Log in with this link?")).toBeTruthy();
    expect(screen.getByText(/A link from someone else would log you into their account/)).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/auth/verify")).toBe(false);

    await fireEvent.press(screen.getByTestId("auth-link-confirm-yes"));
    expect(await screen.findByText("Alma")).toBeTruthy();
    expect(api.calls.filter((c) => c.path === "/auth/verify")).toHaveLength(1);
  });

  it("on the web build drops the token from the address bar while it waits for the tap, and still uses it", async () => {
    const location = { href: `${HOSTED}/auth/app#token=pp_m_strangerlink3`, pathname: "/auth/app" };
    const replaceState = jest.fn(() => { location.href = `${HOSTED}${location.pathname}`; });
    const platform = jest.requireActual("react-native").Platform;
    const before = platform.OS;
    platform.OS = "web";
    Object.assign(globalThis, { window: { location, history: { replaceState } } });
    try {
      const api = fakeApi({
        "POST /auth/verify": { body: { user: ME.user, sessionToken: "pp_s_session" } },
        "GET /me": { body: ME },
        "GET /phones": { body: { phones: [PHONE] } },
      });
      await renderRouter(routes, { initialUrl: "/auth/app" });
      expect(await screen.findByText("Log in with this link?")).toBeTruthy();
      expect(replaceState).toHaveBeenCalled();
      expect(location.href).not.toContain("token=");
      await fireEvent.press(screen.getByTestId("auth-link-confirm-yes"));
      await waitFor(() => expect(api.calls.filter((c) => c.path === "/auth/verify")).toHaveLength(1));
    } finally {
      platform.OS = before;
      delete (globalThis as { window?: unknown }).window;
    }
  });

  it("goes back without using the link when the parent cancels", async () => {
    openLink("pp_m_strangerlink2");
    const api = fakeApi({ "GET /health": { body: { ok: true, mail: "smtp" } } });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    await fireEvent.press(await screen.findByText("Cancel"));
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(api.calls.some((c) => c.path === "/auth/verify")).toBe(false);
  });

  it("names the signed-in account, and ends the replaced session on the server", async () => {
    await SecureStore.setItemAsync("pp.session", "pp_s_saved");
    // Even a link asked for here waits while someone is signed in.
    await SecureStore.setItemAsync("pp.linkAsked", String(Date.now()));
    openLink("pp_m_otherlink123");
    const api = fakeApi({
      "POST /auth/verify": { body: { user: ME.user, sessionToken: "pp_s_new" } },
      "POST /auth/logout": { status: 204 },
      "GET /me": { body: ME },
      "GET /phones": { body: { phones: [PHONE] } },
    });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    expect(await screen.findByText("You are currently logged in as parent@example.org.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/auth/verify")).toBe(false);

    await fireEvent.press(screen.getByTestId("auth-link-confirm-yes"));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/auth/logout")?.auth).toBe("Bearer pp_s_saved"));
    expect(await SecureStore.getItemAsync("pp.session")).toBe("pp_s_new");
  });
});

describe("logging out", () => {
  beforeEach(async () => {
    await SecureStore.setItemAsync("pp.session", "pp_s_saved");
  });

  it("keeps ending the session on the server after a logout without network", async () => {
    await SecureStore.setItemAsync("pp.next", "/phones/abc");
    await SecureStore.setItemAsync("pp.invite", "pp_i_leftbehind1");
    fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /auth/logout": () => {
        throw new TypeError("Network request failed");
      },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByTestId("logout"));
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(await SecureStore.getItemAsync("pp.session")).toBeNull();
    // The next person to sign in here does not land on this account's page or invitation.
    expect(await SecureStore.getItemAsync("pp.next")).toBeNull();
    expect(await SecureStore.getItemAsync("pp.invite")).toBeNull();
    expect(JSON.parse((await SecureStore.getItemAsync("pp.pendingLogout"))!)).toEqual([{ server: HOSTED, token: "pp_s_saved", at: expect.any(Number) }]);

    // Online again (the app tries at every start).
    const api = fakeApi({ "POST /auth/logout": { status: 204 } });
    await retryPendingLogouts();
    expect(api.calls).toEqual([expect.objectContaining({ origin: HOSTED, path: "/auth/logout", auth: "Bearer pp_s_saved" })]);
    expect(JSON.parse((await SecureStore.getItemAsync("pp.pendingLogout"))!)).toEqual([]);
  });

  it("retries a queued logout when the app comes back to the foreground", async () => {
    const handlers: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (state: string) => void) => {
      // Every screen listens too; keep the session's listener only.
      if (new Error().stack?.includes("lib/session")) handlers.push(handler);
      return { remove: () => undefined };
    }) as never);
    await SecureStore.setItemAsync("pp.pendingLogout", JSON.stringify([{ server: HOSTED, token: "pp_s_waiting", at: Date.now() }]));
    const api = fakeApi({ "GET /me": { body: ME }, "GET /health": { body: { ok: true, mail: "smtp" } }, "POST /auth/logout": { status: 204 } });
    await renderRouter(routes, { initialUrl: "/settings" });
    await screen.findByTestId("logout");
    // The start-up retry has run; put the entry back and come back to the app.
    await waitFor(() => expect(api.calls.some((c) => c.auth === "Bearer pp_s_waiting")).toBe(true));
    const before = api.calls.length;
    await SecureStore.setItemAsync("pp.pendingLogout", JSON.stringify([{ server: HOSTED, token: "pp_s_again", at: Date.now() }]));
    handlers.forEach((handler) => handler("active"));
    await waitFor(() => expect(api.calls.slice(before).some((c) => c.auth === "Bearer pp_s_again")).toBe(true));
    jest.restoreAllMocks();
  });

  it("drops a queued logout that is older than the session lifetime, and keeps a recent one", async () => {
    const now = Date.parse("2026-11-21T12:00:00Z");
    jest.spyOn(Date, "now").mockReturnValue(now);
    await SecureStore.setItemAsync("pp.pendingLogout", JSON.stringify([
      { server: HOSTED, token: "pp_s_old", at: now - 61 * 86_400_000 },
      { server: HOSTED, token: "pp_s_recent", at: now - 86_400_000 },
    ]));
    const api = fakeApi({ "POST /auth/logout": () => { throw new TypeError("Network request failed"); } });
    await retryPendingLogouts();
    // The old token is neither tried nor kept.
    expect(api.calls.map((c) => c.auth)).toEqual(["Bearer pp_s_recent"]);
    expect(JSON.parse((await SecureStore.getItemAsync("pp.pendingLogout"))!)).toEqual([
      { server: HOSTED, token: "pp_s_recent", at: now - 86_400_000 },
    ]);
    jest.restoreAllMocks();
  });

  it("ends the session on the old server when switching servers from settings", async () => {
    const custom = "https://plainphone.example.org";
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, compatibility: 1, mail: "smtp" } },
      "POST /auth/logout": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByText("Use your own server"));
    await fireEvent.changeText(await screen.findByLabelText("Server address"), custom);
    await fireEvent.press(screen.getByText("Connect"));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/auth/logout")).toMatchObject({ origin: HOSTED, auth: "Bearer pp_s_saved" }));
  });
});

describe("household members", () => {
  beforeEach(async () => {
    await SecureStore.setItemAsync("pp.session", "pp_s_saved");
  });

  it("lets a parent in two households pick which one the screen shows", async () => {
    const own = ME.households[0].id;
    const other = "00000000-0000-4000-8000-000000000002";
    const two = { ...ME, households: [...ME.households, { id: other, name: "Cabin", role: "parent" }] };
    const api = fakeApi({
      "GET /me": { body: two },
      [`GET /households/${own}/members`]: { body: { members: [{ id: "u1", email: "parent@example.org", role: "owner" }], invites: [] } },
      [`GET /households/${other}/members`]: { body: { members: [{ id: "u1", email: "parent@example.org", role: "parent" }], invites: [] } },
    });
    await renderRouter(routes, { initialUrl: "/household" });
    await waitFor(() => expect(api.calls.some((c) => c.path === `/households/${own}/members`)).toBe(true));
    await fireEvent.press(await screen.findByTestId(`household-option-${other}`));
    await waitFor(() => expect(api.calls.some((c) => c.path === `/households/${other}/members`)).toBe(true));
    expect(await SecureStore.getItemAsync("pp.household")).toBe(other);
  });

  it("moves screen-reader focus to the question, and back to Remove on Cancel", async () => {
    const hid = ME.households[0].id;
    fakeApi({
      "GET /me": { body: ME },
      [`GET /households/${hid}/members`]: {
        body: { members: [{ id: "u1", email: "parent@example.org", role: "owner" }, { id: "u2", email: "co-parent@example.org", role: "parent" }], invites: [] },
      },
    });
    // The test renderer has no native node handles.
    jest.spyOn(require("react-native"), "findNodeHandle").mockReturnValue(7);
    const focus = jest.spyOn(AccessibilityInfo, "setAccessibilityFocus").mockImplementation(() => undefined);
    await renderRouter(routes, { initialUrl: "/household" });
    await fireEvent.press(await screen.findByLabelText("Remove co-parent@example.org"));
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText("Cancel"));
    await waitFor(() => expect(focus).toHaveBeenCalledTimes(2));
    focus.mockRestore();
    jest.restoreAllMocks();
  });

  it("asks before removing another parent", async () => {
    const hid = ME.households[0].id;
    const api = fakeApi({
      "GET /me": { body: ME },
      [`GET /households/${hid}/members`]: {
        body: { members: [{ id: "u1", email: "parent@example.org", role: "owner" }, { id: "u2", email: "co-parent@example.org", role: "parent" }], invites: [] },
      },
      [`DELETE /households/${hid}/members/u2`]: { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/household" });
    await fireEvent.press(await screen.findByLabelText("Remove co-parent@example.org"));
    expect(screen.getByText(/Remove co-parent@example.org from the household\?/)).toBeTruthy();
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    await fireEvent.press(screen.getByTestId("member-remove-confirm-u2"));
    await waitFor(() => expect(api.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([`/households/${hid}/members/u2`]));
  });

  it("lets a new household get a name, and refuses an empty one", async () => {
    const hid = ME.households[0].id;
    let name = ME.households[0].name;
    const api = fakeApi({
      "GET /me": () => ({ body: { ...ME, households: [{ ...ME.households[0], name }] } }),
      [`GET /households/${hid}/members`]: { body: { members: [{ id: "u1", email: "parent@example.org", role: "owner" }], invites: [] } },
      [`PATCH /households/${hid}`]: (c) => {
        name = (c.body as { name: string }).name;
        return { status: 204 };
      },
    });
    await renderRouter(routes, { initialUrl: "/household" });
    const field = await screen.findByTestId("household-name");
    expect(field.props.value).toBe("");
    expect(field.props.placeholder).toBe("For example: Our family");

    await fireEvent.press(screen.getByTestId("household-name-save"));
    expect(await screen.findByText("Write a name of 1 to 60 characters.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);

    await fireEvent.changeText(field, "  Our family  ");
    await fireEvent.press(screen.getByTestId("household-name-save"));
    await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Our family" }));
    expect(await screen.findByText("The name is saved.")).toBeTruthy();
    // The screen's title follows the new name once the session is refreshed.
    expect(await screen.findByText("Our family")).toBeTruthy();
  });
});
