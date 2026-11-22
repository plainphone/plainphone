// SPDX-License-Identifier: Apache-2.0
//
// The sign-in bot check and the calm anti-spam errors (docs/operations.md, "Bot and spam protection").
import { createHash } from "node:crypto";
import { fireEvent, renderRouter, screen } from "expo-router/testing-library";
import { fakeApi } from "../test/fakeApi";

jest.mock("expo-linking", () => {
  const actual = jest.requireActual("expo-linking");
  return { ...actual, getInitialURL: jest.fn(async () => null), useLinkingURL: jest.fn(() => null) };
});

// A cold run transforms the whole router before the first screen renders, which can take longer than
// jest's default 5 seconds when this file happens to run first.
jest.setTimeout(30_000);

const routes = "./src/app";
const SALT = "00112233445566778899aabb?expires=4102444800";
const challenge = (n: number) => ({
  algorithm: "SHA-256",
  challenge: createHash("sha256").update(SALT + n).digest("hex"),
  maxnumber: 3_000,
  salt: SALT,
  signature: "ab".repeat(32),
});
const sent = { status: 202, body: { ok: true, mailEnabled: true } };

async function askForLink(email = "parent@example.org") {
  await renderRouter(routes, { initialUrl: "/login" });
  await fireEvent.changeText(await screen.findByLabelText("Email address"), email);
  await fireEvent.press(screen.getByTestId("login-submit"));
}

const requests = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.path === "/auth/request");

describe("bot check", () => {
  it("solves the server's puzzle in the app and sends the answer", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp", botChallenge: "altcha" } },
      "GET /auth/challenge": { body: challenge(2_345) },
      "POST /auth/request": sent,
    });
    await askForLink();
    expect(await screen.findByText("Check your mail")).toBeTruthy();
    const body = requests(api)[0]!.body as { altcha: string };
    expect(JSON.parse(atob(body.altcha))).toMatchObject({ number: 2_345, salt: SALT, signature: "ab".repeat(32) });
  });

  it("sends no puzzle when the server has the check off", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp", botChallenge: "off" } },
      "POST /auth/request": sent,
    });
    await askForLink();
    expect(await screen.findByText("Check your mail")).toBeTruthy();
    expect(api.calls.some((c) => c.path === "/auth/challenge")).toBe(false);
    expect(requests(api)[0]!.body).toEqual({ email: "parent@example.org", locale: "en", client: "native" });
  });

  it("solves it and asks once more when the server turned the check on since /health was read", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "GET /auth/challenge": { body: challenge(7) },
      "POST /auth/request": (c) => ((c.body as { altcha?: string }).altcha
        ? sent
        : { status: 403, body: { error: "check first", code: "bot_challenge_required" } }),
    });
    await askForLink();
    expect(await screen.findByText("Check your mail")).toBeTruthy();
    expect(requests(api)).toHaveLength(2);
  });

  it("says calmly when the puzzle could not be fetched, and asks for no link", async () => {
    const api = fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp", botChallenge: "altcha" } },
      "GET /auth/challenge": { status: 503, body: { error: "down" } },
      "POST /auth/request": sent,
    });
    await askForLink();
    expect(await screen.findByText("The security check did not work. Try again.")).toBeTruthy();
    expect(requests(api)).toHaveLength(0);
  });
});

describe("throwaway addresses", () => {
  it("explains at the field that a lasting address is needed", async () => {
    fakeApi({
      "GET /health": { body: { ok: true, mail: "smtp" } },
      "POST /auth/request": { status: 422, body: { error: "throwaway", code: "disposable_email" } },
    });
    await askForLink("someone@mailinator.com");
    expect(await screen.findByText(/looks like a temporary mail address/)).toBeTruthy();
    expect(screen.queryByText("Check your mail")).toBeNull();
  });
});
