// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { api } from "../lib/api";
import { LINK_ASKED_KEY } from "../lib/session";
import { AuthCallbackPage } from "./AuthCallback";

const session = vi.hoisted(() => ({
  state: { status: "anon" } as { status: string; me?: unknown },
  refresh: vi.fn(async () => null),
}));
vi.mock("../lib/session", async (original) => ({
  ...(await original<typeof import("../lib/session")>()),
  useSession: () => ({ state: session.state, refresh: session.refresh }),
}));

let root: Root;
let container: HTMLElement;
let verify: ReturnType<typeof vi.spyOn>;
let token = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  session.state = { status: "anon" };
  session.refresh.mockClear();
  verify = vi.spyOn(api, "post").mockResolvedValue(undefined as never);
  // A fresh token per test: the page verifies each token once per page load.
  window.history.replaceState(null, "", `/auth/callback#token=pp_m_test${++token}`);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><I18nProvider><AuthCallbackPage /></I18nProvider></MemoryRouter>));
  await act(async () => undefined);
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);

it("asks before using a login link this browser did not ask for", async () => {
  await mount();
  expect(container.textContent).toContain("Log in with this link?");
  expect(container.textContent).toContain("A link from someone else would log you into their account.");
  expect(verify).not.toHaveBeenCalled();
  // The token is gone from the address bar while the question is shown.
  expect(window.location.hash).toBe("");

  await act(async () => button("Log in")!.click());
  expect(verify).toHaveBeenCalledWith("/auth/verify", { token: `pp_m_test${token}`, locale: "en" });
  expect(session.refresh).toHaveBeenCalled();
});

it("uses a link this browser asked for a moment ago straight away", async () => {
  localStorage.setItem(LINK_ASKED_KEY, String(Date.now() - 5 * 60 * 1000));
  await mount();
  expect(verify).toHaveBeenCalledWith("/auth/verify", { token: `pp_m_test${token}`, locale: "en" });
  expect(container.textContent).not.toContain("Log in with this link?");
  // Used once: a second link needs its own request.
  expect(localStorage.getItem(LINK_ASKED_KEY)).toBeNull();
});

it("asks again when the request from this browser is older than the link can be", async () => {
  localStorage.setItem(LINK_ASKED_KEY, String(Date.now() - 16 * 60 * 1000));
  await mount();
  expect(container.textContent).toContain("Log in with this link?");
  expect(verify).not.toHaveBeenCalled();
});

it("names the signed-in account and waits, even for a link asked for here", async () => {
  localStorage.setItem(LINK_ASKED_KEY, String(Date.now()));
  session.state = { status: "in", me: { user: { id: "u1", email: "parent@example.org", locale: "en" }, households: [], mailEnabled: true } };
  await mount();
  expect(container.textContent).toContain("You are logged in as parent@example.org now.");
  expect(verify).not.toHaveBeenCalled();
});
