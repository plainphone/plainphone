// SPDX-License-Identifier: Apache-2.0
//
// Core flows through the real router and screens, against a fake API.
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import { fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
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
    expect(await screen.findByText(/This server has no mail set up/)).toBeTruthy();
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

  it("switches the language and saves it on the account", async () => {
    const api = fakeApi({ "GET /me": { body: ME }, "PATCH /me": { status: 204 } });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByLabelText("Dansk"));
    expect(await screen.findByText("Log ud")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ locale: "da" });
  });
});
