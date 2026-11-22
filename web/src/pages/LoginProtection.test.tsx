// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
//
// The sign-in form's bot and spam protection (docs/operations.md, "Bot and spam protection"): the
// background ALTCHA puzzle, the hidden honeypot field and the calm errors, each with its off switch.
import { sha256Hex } from "@plainphone/shared/altcha";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { api, ApiError } from "../lib/api";
import { LoginPage } from "./Login";

vi.mock("../lib/session", async (original) => ({
  ...(await original<typeof import("../lib/session")>()),
  useSession: () => ({ state: { status: "anon" }, refresh: async () => null }),
}));
vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  serverHasMail: async () => true,
}));

const SALT = "00112233445566778899aabb?expires=4102444800";
const server = { health: { botChallenge: "off", honeypot: false } as Record<string, unknown>, challengeStatus: 200, challenges: 0, secret: 37 };

function challenge() {
  server.challenges++;
  return { algorithm: "SHA-256", challenge: sha256Hex(SALT + server.secret), maxnumber: 100, salt: SALT, signature: "ab".repeat(32) };
}

let root: Root;
let container: HTMLElement;
let post: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  server.health = { botChallenge: "off", honeypot: false };
  server.challengeStatus = 200;
  server.challenges = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/health") return new Response(JSON.stringify({ ok: true, mail: "smtp", ...server.health }));
    if (url === "/api/auth/challenge") {
      return server.challengeStatus === 200
        ? new Response(JSON.stringify(challenge()))
        : new Response("{}", { status: server.challengeStatus });
    }
    return new Response("{}", { status: 404 });
  }));
  post = vi.spyOn(api, "post").mockResolvedValue({ ok: true, mailEnabled: true } as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><I18nProvider><LoginPage /></I18nProvider></MemoryRouter>));
  // Health, the challenge and its solution all settle.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}

async function type(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => container.querySelector("form")!.requestSubmit());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}

const sent = () => post.mock.calls.at(-1)![1] as Record<string, string>;

it("solves the server's puzzle in the background and sends the answer with the request", async () => {
  server.health = { botChallenge: "altcha", honeypot: false };
  await mount();
  expect(server.challenges).toBe(1);
  await type("email", "parent@example.test");
  await submit();
  const answer = JSON.parse(atob(sent().altcha!));
  expect(answer).toMatchObject({ algorithm: "SHA-256", number: 37, salt: SALT, signature: "ab".repeat(32) });
  expect(container.textContent).toContain("Check your mail");
});

it("uses each answer once: a second request solves a fresh puzzle", async () => {
  server.health = { botChallenge: "altcha", honeypot: false };
  await mount();
  await type("email", "parent@example.test");
  await submit();
  await act(async () => (container.querySelector("button.btn-secondary") as HTMLButtonElement).click());
  await type("email", "parent@example.test");
  await submit();
  expect(server.challenges).toBe(2);
  expect(post).toHaveBeenCalledTimes(2);
});

it("asks for no puzzle and sends none when the server has the check off", async () => {
  await mount();
  await type("email", "parent@example.test");
  await submit();
  expect(server.challenges).toBe(0);
  expect(sent()).toEqual({ email: "parent@example.test", locale: "en" });
});

it("solves the puzzle and asks once more when the server switched the check on after the page opened", async () => {
  await mount();
  post.mockRejectedValueOnce(new ApiError(403, "update", [], { code: "bot_challenge_required", error: "update" }));
  await type("email", "parent@example.test");
  await submit();
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[0]![1]).not.toHaveProperty("altcha");
  expect(JSON.parse(atob(sent().altcha!))).toMatchObject({ number: 37, salt: SALT });
  expect(container.textContent).toContain("Check your mail");
});

it("says calmly when the puzzle could not be fetched, and sends nothing", async () => {
  server.health = { botChallenge: "altcha", honeypot: false };
  server.challengeStatus = 503;
  await mount();
  await type("email", "parent@example.test");
  await submit();
  expect(post).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')!.textContent).toBe("The security check did not work. Try again.");
});

it("shows the server's refusal of an answer as the same calm text", async () => {
  server.health = { botChallenge: "altcha", honeypot: false };
  post.mockRejectedValue(new ApiError(403, "no", [], { code: "bot_challenge_failed", error: "no" }));
  await mount();
  await type("email", "parent@example.test");
  await submit();
  expect(container.textContent).toContain("The security check did not work. Try again.");
});

it("hides the honeypot from people and screen readers, and sends it only when filled", async () => {
  server.health = { botChallenge: "off", honeypot: true };
  await mount();
  const field = container.querySelector<HTMLInputElement>('[data-testid="honeypot"]')!;
  expect(field.tabIndex).toBe(-1);
  expect(field.closest('[aria-hidden="true"]')!.className).toBe("sr-only");
  await type("email", "parent@example.test");
  await submit();
  expect(sent()).not.toHaveProperty("website");
  await act(async () => (container.querySelector("button.btn-secondary") as HTMLButtonElement).click());
  await type("website", "https://spam.example");
  await type("email", "bot@example.test");
  await submit();
  expect(sent().website).toBe("https://spam.example");
});

it("has no honeypot when the server does not check it", async () => {
  await mount();
  expect(container.querySelector('[data-testid="honeypot"]')).toBeNull();
});

it("explains a throwaway address at the field, in the user's language", async () => {
  localStorage.setItem("pp.locale", "da");
  post.mockRejectedValue(new ApiError(422, "throwaway", [], { code: "disposable_email", error: "throwaway" }));
  await mount();
  await type("email", "someone@mailinator.com");
  await submit();
  const input = container.querySelector<HTMLInputElement>('input[name="email"]')!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(container.textContent).toContain("Det ligner en midlertidig mailadresse.");
});
