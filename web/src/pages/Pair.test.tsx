// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { api, ApiError } from "../lib/api";
import { PairPage } from "./Pair";

vi.mock("../lib/session", () => ({ useHouseholdId: () => "h-own" }));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("claims the phone into the household the dashboard shows, not one the server picks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  const posts: { path: string; body: unknown }[] = [];
  vi.spyOn(api, "post").mockImplementation((async (path: string, body: unknown) => {
    posts.push({ path, body });
    return path === "/phones/pairing-profile" ? { profile: null } : { id: "p1", pairedAt: "2026-11-20T12:00:00Z" };
  }) as never);
  window.history.replaceState(null, "", "/pair?code=ABCD-EFGH&profile=self");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/pair?code=ABCD-EFGH"]}><I18nProvider><PairPage /></I18nProvider></MemoryRouter>,
    ));
    await act(async () => undefined);
    const field = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Test phone");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(posts.find((p) => p.path === "/phones/claim")?.body).toMatchObject({ code: "ABCD-EFGH", name: "Test phone", householdId: "h-own" });
    // The code is kept in state, not in the address bar.
    expect(window.location.search).toBe("?profile=self");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("explains the server's phone cap in the parent's language", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "da");
  vi.spyOn(api, "post").mockImplementation((async (path: string) => {
    if (path === "/phones/pairing-profile") return { profile: null };
    throw new ApiError(403, "cap", [], { error: "cap", code: "household_phone_cap", max: 10 });
  }) as never);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/pair?code=ABCD-EFGH"]}><I18nProvider><PairPage /></I18nProvider></MemoryRouter>,
    ));
    await act(async () => undefined);
    const field = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Test phone");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    expect(container.textContent).toContain(makeT("da")("phoneCap.error", { max: 10 }));
    expect(container.textContent).toContain("10 telefoner");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
