// SPDX-License-Identifier: Apache-2.0
//
// Core flows through the real router and screens, against a fake API.
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { Linking as RNLinking, StyleSheet } from "react-native";
import { act, fireEvent, renderRouter, screen, testRouter, waitFor } from "expo-router/testing-library";
import { getSessionToken } from "../src/api/client";
import { clearPendingInvite } from "../src/lib/pendingInvite";
import { dark } from "../src/lib/theme";
import { fakeApi, ME, PHONE } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

const routes = "./src/app";

/** The app asked for a login link a moment ago, so the link that comes back is used without a question. */
const askedForLink = () => SecureStore.setItemAsync("pp.linkAsked", String(Date.now()));

describe("logging in", () => {
  it("asks for a login link the app can open", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /auth/request": { status: 202, body: { ok: true, mailEnabled: true } },
    });
    await renderRouter(routes, { initialUrl: "/" });
    // Signed out: the start screen sends you to log in.
    await waitFor(() => expect(screen).toHavePathname("/login"));
    // A new parent has no account yet: the heading covers both.
    expect(await screen.findByText("Log in or create an account")).toBeTruthy();
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

  it("lets only the store review address log in with a code", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /auth/request": { status: 202, body: { ok: true, mailEnabled: true, codeSignIn: true } },
      "POST /auth/review": (c) => ((c.body as { code: string }).code === "the-review-code"
        ? { body: { user: ME.user, sessionToken: "pp_s_review" } }
        : { status: 401, body: { error: "wrong address or code" } }),
      "GET /me": (c) => (c.auth === "Bearer pp_s_review" ? { body: ME } : { status: 401, body: { error: "sign in first" } }),
      "GET /phones": { body: { phones: [PHONE] } },
    });
    await renderRouter(routes, { initialUrl: "/login" });
    expect(screen.queryByTestId("login-code")).toBeNull();
    await fireEvent.changeText(await screen.findByLabelText("Email address"), "review@example.org");
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Log in with a code")).toBeTruthy();
    expect(screen.queryByText("Check your mail")).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Code"), "wrong");
    await fireEvent.press(screen.getByTestId("login-code-submit"));
    expect(await screen.findByText("The code doesn’t match this address. Check it and try again.")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Code"), " the-review-code ");
    await fireEvent.press(screen.getByTestId("login-code-submit"));
    expect(await screen.findByText("Alma")).toBeTruthy();
    expect(api.calls.filter((c) => c.path === "/auth/review").at(-1)!.body).toEqual({
      email: "review@example.org", code: "the-review-code", locale: "en", client: "native",
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("pp.session", "pp_s_review");
  });

  it("explains calmly when the hosted service has taken today's new families", async () => {
    const open = jest.spyOn(RNLinking, "openURL").mockResolvedValue(undefined);
    try {
      fakeApi({
        "GET /health": { body: { ok: true, mail: "smtp" } },
        "POST /auth/request": {
          status: 429,
          body: { error: "capped", code: "signup_cap_reached", retryAt: "2026-11-23T00:00:00.000Z" },
        },
      });
      await renderRouter(routes, { initialUrl: "/login" });
      await fireEvent.changeText(await screen.findByLabelText("Email address"), "new@example.org");
      await fireEvent.press(screen.getByTestId("login-submit"));
      expect(await screen.findByText("Full for today")).toBeTruthy();
      expect(screen.getByText(/limited number of new families each day/)).toBeTruthy();
      expect(screen.queryByText("Check your mail")).toBeNull();
      await fireEvent.press(screen.getByRole("link", { name: /self-hosting/i }));
      expect(open).toHaveBeenCalledWith("https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md");
    } finally {
      open.mockRestore();
    }
  });

  it("uses the selected server for sign-in and can return to the hosted service", async () => {
    const custom = "https://plainphone.example.org";
    const api = fakeApi({
      "GET /health": { body: { ok: true, compatibility: 1, mail: "smtp" } },
      "POST /auth/request": { status: 202, body: { mailEnabled: true } },
    });
    await renderRouter(routes, { initialUrl: "/login" });
    await fireEvent.press(await screen.findByText("Use your own server"));
    await fireEvent.changeText(await screen.findByLabelText("Server address"), custom);
    await fireEvent.press(screen.getByText("Connect"));
    await screen.findByText(`This app talks to ${custom}.`);
    expect(await SecureStore.getItemAsync("pp.server")).toBe(custom);
    await fireEvent.changeText(screen.getByLabelText("Email address"), "parent@example.org");
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Check your mail")).toBeTruthy();
    expect(api.calls.find((call) => call.path === "/auth/request")?.origin).toBe(custom);

    await fireEvent.press(screen.getByText("Use another address"));
    await fireEvent.press(screen.getByText("Use plainphone.org"));
    await screen.findByText("This app talks to https://app.plainphone.org.");
    expect(await SecureStore.getItemAsync("pp.server")).toBe("https://app.plainphone.org");
  });

  it("restores a custom session and registers push on that server", async () => {
    const server = "https://plainphone.example.org";
    await SecureStore.setItemAsync("pp.server", server);
    await SecureStore.setItemAsync("pp.session", "pp_s_hosted");
    await SecureStore.setItemAsync("pp.customSession", JSON.stringify({ server, token: "pp_s_custom" }));
    jest.mocked(Notifications.getDevicePushTokenAsync)
      .mockResolvedValueOnce({ type: "ios", data: "native-test-token-123456789" });
    const api = fakeApi({
      "GET /me": { body: ME },
      "POST /notifications/subscriptions": { status: 201, body: { id: "fixture" } },
    });

    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByText("Turn on notifications"));
    expect(await screen.findByText("Notifications are registered on this server.")).toBeTruthy();
    expect(api.calls.find((call) => call.path === "/notifications/subscriptions")).toMatchObject({
      origin: server,
      auth: "Bearer pp_s_custom",
      body: { token: "native-test-token-123456789" },
    });
    expect(api.calls.every((call) => call.auth !== "Bearer pp_s_hosted")).toBe(true);
  });

  it("warns when the server cannot send mail", async () => {
    await SecureStore.setItemAsync("pp.server", "https://plainphone.example.org");
    fakeApi({
      "GET /health": ({ origin }) => ({ body: { ok: true, mail: origin.includes("example.org") ? "none" : "smtp" } }),
      "POST /auth/request": { status: 202, body: { mailEnabled: false } },
    });
    await renderRouter(routes, { initialUrl: "/login" });
    expect(await screen.findByText("The server can’t send sign-in links.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Email address"), "parent@example.org");
    await fireEvent.press(screen.getByTestId("login-submit"));
    await fireEvent.press(screen.getByText("Use your own server"));
    await fireEvent.press(screen.getByText("Use plainphone.org"));
    expect(await screen.findByText("This app talks to https://app.plainphone.org.")).toBeTruthy();
  });

  it("shows the self-hosting guide as a link in the accent colour in dark mode", async () => {
    const scheme = jest.spyOn(require("react-native/Libraries/Utilities/useColorScheme"), "default").mockReturnValue("dark");
    const open = jest.spyOn(RNLinking, "openURL").mockResolvedValue(undefined);
    try {
      await SecureStore.setItemAsync("pp.server", "https://plainphone.example.org");
      fakeApi({
        "GET /health": ({ origin }) => ({ body: { ok: true, mail: origin.includes("example.org") ? "none" : "smtp" } }),
      });
      await renderRouter(routes, { initialUrl: "/login" });
      await fireEvent.press(await screen.findByText("Do you run your own server?"));
      const link = screen.getByRole("link", { name: /self-hosting/i });
      expect(StyleSheet.flatten(screen.getByText(/self-hosting/i).props.style).color).toBe(dark.accent);
      await fireEvent.press(link);
      expect(open).toHaveBeenCalledWith("https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md");
    } finally {
      scheme.mockRestore();
      open.mockRestore();
    }
  });

  it("holds login submissions until server validation finishes", async () => {
    const custom = "https://plainphone.example.org";
    const api = fakeApi({
      "GET /health": { body: { ok: true, compatibility: 1, mail: "smtp" } },
      "POST /auth/request": { status: 202, body: { mailEnabled: true } },
    });
    const fetchApi = globalThis.fetch;
    let release!: () => void;
    const checking = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === custom && url.pathname === "/api/health") await checking;
      return fetchApi(input, init);
    };
    await renderRouter(routes, { initialUrl: "/login" });
    await fireEvent.changeText(await screen.findByLabelText("Email address"), "parent@example.org");
    await fireEvent.press(screen.getByText("Use your own server"));
    await fireEvent.changeText(await screen.findByLabelText("Server address"), custom);
    await fireEvent.press(screen.getByText("Connect"));
    await fireEvent.press(screen.getByTestId("login-submit"));
    await fireEvent(screen.getByTestId("login-email"), "submitEditing");
    expect(api.calls.filter((call) => call.path === "/auth/request")).toHaveLength(0);
    await act(async () => release());
    expect(await screen.findByText(`This app talks to ${custom}.`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Check your mail")).toBeTruthy();
    expect(api.calls.filter((call) => call.path === "/auth/request")).toEqual([
      expect.objectContaining({ origin: custom }),
    ]);
  });

  it("opens the login link, keeps the session in the keychain and shows the phones", async () => {
    await askedForLink();
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce("https://app.plainphone.org/auth/app#token=pp_m_linktoken123");
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    const api = fakeApi({
      "POST /auth/verify": { body: { user: ME.user, sessionToken: "pp_s_session" } },
      "GET /me": (c) => (c.auth === "Bearer pp_s_session" ? { body: ME } : { status: 401, body: { error: "sign in first" } }),
      "GET /phones": { body: { phones: [PHONE] } },
      "POST /notifications/subscriptions": { status: 201, body: { id: "native-subscription" } },
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
    await waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledWith("pp.push-registration", expect.any(String)));
    expect(api.calls.find((call) => call.path === "/notifications/subscriptions")).toMatchObject({
      auth: "Bearer pp_s_session", body: { platform: "fcm", token: "fcm-token" },
    });
  });

  it("says so when the link is used up", async () => {
    await askedForLink();
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce("https://app.plainphone.org/auth/app#token=pp_m_usedtoken123");
    fakeApi({ "POST /auth/verify": { status: 400, body: { error: "this link is expired or already used" } } });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    expect(await screen.findByText("This login link is expired or already used. Ask for a new one.")).toBeTruthy();
  });
});

describe("coming back after the app was closed during login", () => {
  const login = (token: string) => {
    void askedForLink();
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(`https://app.plainphone.org/auth/app#token=${token}`);
  };
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
    // An invitation always waits for a tap, also one kept across the login.
    await fireEvent.press(await screen.findByTestId("invite-accept"));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/invites/accept")).toBe(true));
    expect(api.calls.find((c) => c.path === "/invites/accept")!.body).toEqual({ token: "pp_i_invitetoken123" });
    await waitFor(() => expect(screen).toHavePathname("/invite"));
  });

  it("explains an invitation for another address, signs out and keeps the link", async () => {
    await SecureStore.setItemAsync("pp.invite", "pp_i_othertoken789");
    login("pp_m_linktoken456");
    const api = signedInApi({
      "POST /invites/accept": { status: 403, body: { error: "this invitation was sent to another e-mail address", code: "invite_email_mismatch" } },
      "POST /auth/logout": { status: 204 },
    });
    await renderRouter(routes, { initialUrl: "/auth/app" });
    await fireEvent.press(await screen.findByTestId("invite-accept"));
    expect(await screen.findByText("This invitation was sent to another e-mail address. Sign in with that address, or ask for a new invitation.")).toBeTruthy();
    expect(await SecureStore.getItemAsync("pp.invite")).toBe("pp_i_othertoken789");

    await fireEvent.press(screen.getByTestId("invite-signout"));
    await waitFor(() => expect(api.calls.some((c) => c.path === "/auth/logout")).toBe(true));
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(await SecureStore.getItemAsync("pp.invite")).toBe("pp_i_othertoken789");
    // The next test must not find this invitation waiting.
    await clearPendingInvite();
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
    // Someone is signed in, so the link asks before it replaces the session.
    await fireEvent.press(await screen.findByTestId("auth-link-confirm-yes"));
    expect(await screen.findByText("This login link is expired or already used. Ask for a new one.")).toBeTruthy();
    await testRouter.replace("/");
    expect(await screen.findByText("Alma")).toBeTruthy();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(real);
  });

  it("sends a second login link to the start screen, not to the last destination again", async () => {
    await SecureStore.setItemAsync("pp.next", "/pair?code=K7MP4QXR");
    await askedForLink();
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
    // Signed in now: a second link asks before it replaces the session.
    await fireEvent.press(await screen.findByTestId("auth-link-confirm-yes"));
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
    await askedForLink();
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

  it("deletes the account from settings after the address is typed", async () => {
    let deleted = false;
    const api = fakeApi({
      "GET /me": () => (deleted ? { status: 401, body: { error: "sign in first" } } : { body: ME }),
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "DELETE /me": () => {
        deleted = true;
        return { body: { status: "deleted", householdsDeleted: 1, phonesRemoved: 1 } };
      },
      "POST /auth/logout": { status: 401, body: { error: "sign in first" } },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByTestId("delete-account"));
    expect(screen.getByText("Your account is deleted immediately and can’t be recovered.")).toBeTruthy();
    // Nothing happens until the own address is typed.
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/me")).toBe(false);
    await fireEvent.changeText(screen.getByLabelText("Type your email address to confirm"), ` ${ME.user.email.toUpperCase()} `);
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    await waitFor(() => expect(screen).toHavePathname("/login"));
    expect(api.calls.find((c) => c.method === "DELETE" && c.path === "/me")!.body).toEqual({ confirmEmail: ME.user.email.toUpperCase() });
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("pp.session");
  });

  it("names the phones that must be removed before the account can go", async () => {
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "GET /phones": { body: { phones: [{ ...PHONE, id: "self-1", name: "My phone" }] } },
      "DELETE /me": { status: 409, body: { error: "remove the Self phones first", selfPhoneIds: ["self-1"] } },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByTestId("delete-account"));
    await fireEvent.changeText(screen.getByLabelText("Type your email address to confirm"), ME.user.email);
    await fireEvent.press(screen.getByTestId("delete-account-confirm"));
    expect(await screen.findByText("First remove these phones. They have a key, so removing them waits for it. Then you can delete the account.")).toBeTruthy();
    expect(screen.getByText("My phone")).toBeTruthy();
    expect(screen).toHavePathname("/settings");
    expect(api.calls.filter((c) => c.path === "/auth/logout")).toHaveLength(0);
  });

  it("keeps login disabled when a switch from settings is still being saved", async () => {
    const custom = "https://plainphone.example.org";
    const api = fakeApi({
      "GET /me": { body: ME },
      "GET /health": { body: { ok: true, compatibility: 1, mail: "smtp" } },
      "POST /auth/request": { status: 202, body: { mailEnabled: true } },
    });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByText("Use your own server"));
    await fireEvent.changeText(await screen.findByLabelText("Server address"), custom);

    const forget = jest.mocked(SecureStore.deleteItemAsync).getMockImplementation()!;
    let release!: () => void;
    const saving = new Promise<void>((resolve) => { release = resolve; });
    jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(async (key) => {
      await saving;
      await forget(key);
    });
    await fireEvent.press(screen.getByText("Connect"));
    await fireEvent.changeText(await screen.findByLabelText("Email address"), "parent@example.org");
    await fireEvent(screen.getByTestId("login-email"), "submitEditing");
    expect(api.calls.filter((call) => call.path === "/auth/request")).toHaveLength(0);
    await act(async () => release());
    expect(await screen.findByText(`This app talks to ${custom}.`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("login-submit"));
    expect(await screen.findByText("Check your mail")).toBeTruthy();
    expect(api.calls.filter((call) => call.path === "/auth/request")).toEqual([
      expect.objectContaining({ origin: custom }),
    ]);
  });

  it("switches the language and saves it on the account", async () => {
    const api = fakeApi({ "GET /me": { body: ME }, "PATCH /me": { status: 204 } });
    await renderRouter(routes, { initialUrl: "/settings" });
    await fireEvent.press(await screen.findByLabelText("Dansk"));
    expect(await screen.findByText("Log ud")).toBeTruthy();
    expect(api.calls.find((c) => c.method === "PATCH")!.body).toEqual({ locale: "da" });
  });
});
