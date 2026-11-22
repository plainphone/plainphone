// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { api, ApiError } from "../lib/api";
import { LoginPage } from "./Login";

const session = vi.hoisted(() => ({
  state: { status: "anon" } as { status: string },
  refresh: vi.fn(async () => null as unknown),
}));
vi.mock("../lib/session", async (original) => ({
  ...(await original<typeof import("../lib/session")>()),
  useSession: () => ({ state: session.state, refresh: session.refresh }),
}));
vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  serverHasMail: async () => true,
}));

let root: Root;
let container: HTMLElement;
let post: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  session.refresh.mockReset().mockResolvedValue(null);
  post = vi.spyOn(api, "post");
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
  await act(async () => undefined);
}

it("sends an ordinary address a link and never shows a code field", async () => {
  post.mockResolvedValue({ ok: true, mailEnabled: true } as never);
  await mount();
  await type("email", "parent@example.test");
  await submit();
  expect(post).toHaveBeenCalledWith("/auth/request", { email: "parent@example.test", locale: "en" });
  expect(container.textContent).toContain("Check your mail");
  expect(container.querySelector('input[name="code"]')).toBeNull();
});

it("asks the review address for its code and signs in with it", async () => {
  post.mockResolvedValueOnce({ ok: true, mailEnabled: true, codeSignIn: true } as never);
  await mount();
  await type("email", "review@example.test");
  await submit();
  expect(container.textContent).toContain("Log in with a code");
  expect(container.textContent).not.toContain("Check your mail");

  post.mockRejectedValueOnce(new ApiError(401, "wrong address or code"));
  await type("code", "wrong");
  await submit();
  expect(container.textContent).toContain("The code doesn’t match this address.");
  expect(session.refresh).not.toHaveBeenCalled();

  post.mockResolvedValueOnce({ user: {} } as never);
  await type("code", " the-review-code ");
  await submit();
  expect(post).toHaveBeenLastCalledWith("/auth/review", { email: "review@example.test", code: "the-review-code", locale: "en" });
  expect(session.refresh).toHaveBeenCalled();
});

it("explains calmly when the hosted service has taken today's new families", async () => {
  post.mockRejectedValue(new ApiError(429, "capped", [], { code: "signup_cap_reached", error: "capped" }));
  await mount();
  await type("email", "new@example.org");
  await submit();
  const notice = container.querySelector('[data-testid="signup-capped"]')!;
  expect(notice.getAttribute("role")).toBe("status");
  expect(notice.textContent).toContain("Full for today");
  expect(notice.textContent).toContain("Try again tomorrow.");
  expect(notice.querySelector("a")!.getAttribute("href")).toBe(
    "https://github.com/plainphone/plainphone/blob/main/docs/self-hosting.md",
  );
  // Not the generic "too many" error, and no "check your mail".
  expect(container.textContent).not.toContain("Check your mail");
  expect(container.textContent).not.toContain("Too many");
});

it("still shows the usual error for other refusals", async () => {
  post.mockRejectedValue(new ApiError(429, "slow down"));
  await mount();
  await type("email", "busy@example.org");
  await submit();
  expect(container.querySelector('[data-testid="signup-capped"]')).toBeNull();
});
