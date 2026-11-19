// SPDX-License-Identifier: Apache-2.0
//
// Core flows through the real router and screens, against a fake API.
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from "expo-router/testing-library";
import { retrySosLogout } from "../src/lib/notifications";
import { getSessionToken } from "../src/api/client";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";

describe("logging in", () => {
  it("asks for a login link the app can open", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /auth/request": { status: 202, body: { ok: true, mailEnabled: true } },
    });
    await renderRouter(routes, { initialUrl: "/" });
    // Signed out: the start screen sends you to log in.
    await waitFor(() => expect(screen).toHavePathname("/login"));
    await fireEvent.changeText(screen.getByLabelText("Email address"), "not-an-address");
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Enter a valid email address, like name@example.com.")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/auth/request")).toBe(false);

    await fireEvent.changeText(screen.getByLabelText("Email address"), " parent@example.org ");
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Check your mail")).toBeTruthy();
    const req = api.calls.find((c) => c.path === "/auth/request")!;
    expect(req.body).toEqual({ email: "parent@example.org", locale: "en", client: "native" });
  });

  it("warns when the server cannot send mail", async () => {
    fakeApi({ "GET /health": { body: { ok: true, mail: "none" } } });
    await renderRouter(routes, { initialUrl: "/login" });
    expect(await screen.findByText("The server can’t send sign-in links.")).toBeTruthy();
  });

  it("opens the login link, keeps the session in the keychain and shows the phones", async () => {
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce("https://app.plainphone.org/auth/app#token=pp_m_linktoken123");
    const api = fakeApi({
      "POST /auth/verify": { body: { user: ME.user, sessionToken: "pp_s_session" } },
      "GET /me": (c) => (c.auth === "Bearer pp_s_session" ? { body: ME } : { status: 401, body: { error: "sign in first" } }),
      "GET /phones": { body: { phones: [PHONE] } },
    });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    expect(await screen.findByText("Alma")).toBeTruthy();
    expect(screen).toHavePathname("/");
    expect(api.calls.find((c) => c.path === "/auth/verify")!.body).toEqual({
      token: "pp_m_linktoken123",
      locale: "en",
      client: "native",
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("pp.session", "pp_s_session");
    // Every later call carries the Bearer token, never a cookie.
    expect(api.calls.filter((c) => c.path === "/phones").every((c) => c.auth === "Bearer pp_s_session")).toBe(true);
  });

  it("says so when the link is used up", async () => {
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce("https://app.plainphone.org/auth/app#token=pp_m_usedtoken123");
    fakeApi({ "POST /auth/verify": { status: 400, body: { error: "this link is expired or already used" } } });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    expect(await screen.findByText("This login link is expired or already used. Ask for a new one.")).toBeTruthy();
  });
});

describe("coming back after the app was closed during login", () => {
  const login = (token: string) =>
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(`https://app.plainphone.org/auth/app#token=${token}`);
  const signedInApi = (extra = {}) =>
    fakeApi({
      "POST /auth/verify": { body: { user: ME.user, sessionToken: "pp_s_session" } },
      "GET /me": { body: ME },
      "GET /phones": { body: { phones: [] } },
      ...extra,
    });

  it("accepts the invitation that was waiting", async () => {
    await SecureStore.setItemAsync("pp.invite", "pp_i_invitetoken123");
    login("pp_m_linktoken456");
    const api = signedInApi({ "POST /invites/accept": { body: { householdId: ME.households[0].id } } });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    await waitFor(() => expect(api.calls.some((c) => c.path === "/invites/accept")).toBe(true));
    expect(api.calls.find((c) => c.path === "/invites/accept")!.body).toEqual({ token: "pp_i_invitetoken123" });
    await waitFor(() => expect(screen).toHavePathname("/invite"));
  });

  it("goes back to the pairing link that was opened", async () => {
    await SecureStore.setItemAsync("pp.next", "/pair?code=K7MP4QXR");
    login("pp_m_linktoken789");
    signedInApi();
    await renderRouter(routes, { initialUrl: "/auth/app" });
    await waitFor(() => expect(screen).toHavePathname("/pair"));
    expect(screen).toHaveSearchParams({ code: "K7MP4QXR" });
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("pp.next");
  });

  it("never follows a stored path out of the app", async () => {
    await SecureStore.setItemAsync("pp.next", "//evil.example/x");
    login("pp_m_linktoken000");
    signedInApi();
    await renderRouter(routes, { initialUrl: "/auth/app" });
    await waitFor(() => expect(screen).toHavePathname("/"));
  });
});

describe("login links in other situations", () => {
  it("keeps the saved session when an old link fails at start-up", async () => {
    await SecureStore.setItemAsync("pp.session", "pp_s_saved");
    // A slow keychain: the link is checked before the saved session has been read.
    const real = (SecureStore.getItemAsync as jest.Mock).getMockImplementation()!;
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (k: string) => {
      await new Promise((r) => setTimeout(r, 100));
      return real(k);
    });
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce("https://app.plainphone.org/auth/app#token=pp_m_oldlink12345");
    fakeApi({
      "POST /auth/verify": { status: 400, body: { error: "this link is expired or already used" } },
      "GET /me": (c) => (c.auth === "Bearer pp_s_saved" ? { body: ME } : { status: 401, body: { error: "sign in first" } }),
      "GET /phones": { body: { phones: [PHONE] } },
    });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    expect(await screen.findByText("This login link is expired or already used. Ask for a new one.")).toBeTruthy();
    await testRouter.replace("/");
    expect(await screen.findByText("Alma")).toBeTruthy();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(real);
  });

  it("sends a second login link to the start screen, not to the last destination again", async () => {
    await SecureStore.setItemAsync("pp.next", "/pair?code=K7MP4QXR");
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce("https://app.plainphone.org/auth/app#token=pp_m_firstlink123");
    let n = 0;
    fakeApi({
      "POST /auth/verify": () => ({ body: { user: ME.user, sessionToken: `pp_s_${++n}` } }),
      "GET /me": { body: ME },
      "GET /phones": { body: { phones: [PHONE] } },
    });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    await waitFor(() => expect(screen).toHavePathname("/pair"));
    (Linking.useLinkingURL as jest.Mock).mockReturnValue("https://app.plainphone.org/auth/app#token=pp_m_secondlink12");
    await act(() => router.push("/auth/app"));
    await waitFor(() => expect(screen).toHavePathname("/"));
    (Linking.useLinkingURL as jest.Mock).mockReturnValue(null);
  });

  it("opens on top of the login screen and leaves no login screen behind", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /auth/verify": { body: { user: ME.user, sessionToken: "pp_s_session" } },
      "GET /me": { body: ME },
      "GET /phones": { body: { phones: [PHONE] } },
    });
    await renderRouter(routes, { initialUrl: "/login" });
    expect(await screen.findByTestId("login")).toBeTruthy();
    (Linking.useLinkingURL as jest.Mock).mockReturnValue("https://app.plainphone.org/auth/app#token=pp_m_warmlink1234");
    await act(() => router.push("/auth/app"));
    expect(await screen.findByText("Alma")).toBeTruthy();
    expect(screen).toHavePathname("/");
    expect(testRouter.canGoBack()).toBe(false);
    expect(api.calls.filter((c) => c.path === "/auth/verify")).toHaveLength(1);
    (Linking.useLinkingURL as jest.Mock).mockReturnValue(null);
  });
});

describe("signed in", () => {
  beforeEach(async () => {
    await SecureStore.setItemAsync("pp.session", "pp_s_saved");
  });

  it("lists phones with waiting changes on Self phones", async () => {
    fakeApi({
      "GET /me": { body: ME },
      "GET /phones": { body: { phones: [PHONE, { ...PHONE, id: "22222222-2222-4222-8222-222222222222", name: "Mine", profile: "self" }] } },
      "GET /phones/22222222-2222-4222-8222-222222222222/changes": {
        body: { changes: [{ id: "c1", op: { type: "app.set", packageName: "com.example", allowed: true }, keyType: "delay", effectiveAt: null }] },
      },
    });
    await renderRouter(routes, { initialUrl: "/" });
    expect(await screen.findByText("Alma")).toBeTruthy();
    expect(screen.getByText("Mine")).toBeTruthy();
    expect(screen.getByText("1 change waiting")).toBeTruthy();
  });

  it("signs out locally when the server no longer knows the session", async () => {
    fakeApi({
      "GET /me": { status: 401, body: { error: "sign in first" } },
      "GET /health": { body: { ok: true, mail: "smtp" } },
    });
    await renderRouter(routes, { initialUrl: "/" });
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("pp.session");
  });

  it("logs out from settings and forgets the token", async () => {
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /auth/logout": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByTestId("logout"));
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(api.calls.find((c) => c.path === "/auth/logout")!.auth).toBe("Bearer pp_s_saved");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("pp.session");
  });

  it("signs out offline and revokes the old SOS subscription when back online", async () => {
    const path = "/notifications/subscriptions/test-sos";
    await SecureStore.setItemAsync("sos-push-subscription", "test-sos");
    let offline = false;
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      [`DELETE ${path}`]: () => {
        if (offline) throw new Error("offline");
        return { status: 204 };
      },
      "POST /auth/logout": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    const logout = await screen.findByTestId("logout");
    offline = true;
    await fireEvent.press(logout);
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(getSessionToken()).toBeNull();
    expect(api.calls.filter((call) => call.path === "/auth/logout")).toHaveLength(0);

    offline = false;
    await retrySosLogout();
    expect(api.calls.filter((call) => call.path === path).map((call) => call.auth))
      .toEqual(["Bearer pp_s_saved", "Bearer pp_s_saved"]);
    expect(api.calls.find((call) => call.path === "/auth/logout")?.auth).toBe("Bearer pp_s_saved");
    expect(await SecureStore.getItemAsync("sos-pending-logout")).toBe("[]");
    expect(getSessionToken()).toBeNull();
  });

  it("removes the SOS registration by its token when the old session expired before going online", async () => {
    const token = "ExponentPushToken[example1234567890]";
    await SecureStore.setItemAsync("sos-push-subscription", "test-sos");
    await SecureStore.setItemAsync("sos-push-token", token);
    let offline = false;
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "DELETE /notifications/subscriptions/test-sos": () => {
        if (offline) throw new Error("offline");
        return { status: 401, body: { error: "sign in first" } };
      },
      "POST /notifications/subscriptions/revoke": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    const logout = await screen.findByTestId("logout");
    offline = true;
    await fireEvent.press(logout);
    await waitFor(() => expect(screen).toHavePathname("/login"));
    offline = false;
    await retrySosLogout();
    expect(api.calls.find((call) => call.path === "/notifications/subscriptions/revoke")?.body).toEqual({ token });
    expect(await SecureStore.getItemAsync("sos-pending-logout")).toBe("[]");
  });

  it("switches the language and saves it on the account", async () => {
    const api = fakeApi({ "GET /me": { body: ME }, "PATCH /me": { status: 204 } });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByLabelText("Dansk"));
    expect(await screen.findByText("Log ud")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ locale: "da" });
  });
});
