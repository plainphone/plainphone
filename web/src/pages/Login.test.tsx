// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import * as apiModule from "../lib/api";
import { LoginPage } from "./Login";

vi.mock("../lib/session", async (original) => ({
  ...(await original<typeof import("../lib/session")>()),
  useSession: () => ({ state: { status: "anon" }, refresh: vi.fn(async () => null) }),
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
  vi.spyOn(apiModule, "serverHasMail").mockResolvedValue(true);
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
