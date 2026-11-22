// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { api, ApiError } from "../lib/api";
import { LoginPage } from "./Login";

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  serverHasMail: async () => true,
}));
vi.mock("../lib/session", async (original) => ({
  ...(await original<typeof import("../lib/session")>()),
  useSession: () => ({ state: { status: "anon" }, refresh: async () => null }),
}));

const hosted = vi.hoisted(() => ({ value: false }));
vi.mock("../lib/site-links", async (original) => ({
  ...(await original<typeof import("../lib/site-links")>()),
  isHostedService: () => hosted.value,
}));

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(locale: string) {
  localStorage.setItem("pp.locale", locale);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </I18nProvider>,
    );
  });
}

const links = () => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));

it("links the terms and the privacy policy on the hosted test service", async () => {
  hosted.value = true;
  await render("da");
  expect(links()).toContain("https://plainphone.org/da/terms/");
  expect(links()).toContain("https://plainphone.org/da/privacy/");
  expect(container.textContent).toContain("Vilkår for testtjenesten");
});

it("shows no terms on a self-hosted server", async () => {
  hosted.value = false;
  await render("en");
  expect(links().some((h) => h?.includes("/terms/"))).toBe(false);
});

async function submit(email: string) {
  await render("en");
  const input = container.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.requestSubmit());
  await act(async () => undefined);
}

it("explains calmly when the hosted service has taken today's new families", async () => {
  vi.spyOn(api, "post").mockRejectedValue(
    new ApiError(429, "capped", [], { code: "signup_cap_reached", error: "capped" }),
  );
  await submit("new@example.org");
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
  vi.spyOn(api, "post").mockRejectedValue(new ApiError(429, "slow down"));
  await submit("busy@example.org");
  expect(container.querySelector('[data-testid="signup-capped"]')).toBeNull();
});
