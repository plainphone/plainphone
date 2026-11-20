// SPDX-License-Identifier: Apache-2.0
//
// Who is signed in: links that would sign the app into someone else's account, logouts the
// server never heard about, and the household members a parent can remove.
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
    expect(JSON.parse((await SecureStore.getItemAsync("pp.pendingLogout"))!)).toEqual([{ server: HOSTED, token: "pp_s_saved" }]);

    // Online again (the app tries at every start).
    const api = fakeApi({ "POST /auth/logout": { status: 204 } });
    await retryPendingLogouts();
    expect(api.calls).toEqual([expect.objectContaining({ origin: HOSTED, path: "/auth/logout", auth: "Bearer pp_s_saved" })]);
    expect(JSON.parse((await SecureStore.getItemAsync("pp.pendingLogout"))!)).toEqual([]);
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
});
