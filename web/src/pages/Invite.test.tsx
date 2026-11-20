// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { api } from "../lib/api";
import { INVITE_KEY } from "../lib/session";
import { InvitePage } from "./Invite";

vi.mock("../lib/session", async (original) => ({
  ...(await original<typeof import("../lib/session")>()),
  useSession: () => ({ state: { status: "in", me: { user: { id: "u1", email: "parent@example.org" }, households: [] } }, refresh: async () => null }),
}));

let root: Root;
let container: HTMLElement;
let accept: ReturnType<typeof vi.spyOn>;
let n = 0;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  accept = vi.spyOn(api, "post").mockResolvedValue({ householdId: "h2" } as never);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open(token: string) {
  window.history.replaceState(null, "", `/invite#token=${token}`);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><I18nProvider><InvitePage /></I18nProvider></MemoryRouter>));
  await act(async () => undefined);
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);

it("joins a household only after the parent says yes", async () => {
  const token = `pp_i_household${++n}`;
  await open(token);
  expect(container.textContent).toContain("Only join if you know who sent the invitation.");
  expect(accept).not.toHaveBeenCalled();

  await act(async () => button("Join the household")!.click());
  expect(accept).toHaveBeenCalledWith("/invites/accept", { token });
  expect(container.textContent).toContain("You are now part of the household");
  expect(sessionStorage.getItem(INVITE_KEY)).toBeNull();
});

it("forgets the invitation when the parent cancels", async () => {
  await open(`pp_i_household${++n}`);
  expect(sessionStorage.getItem(INVITE_KEY)).not.toBeNull();
  await act(async () => [...container.querySelectorAll("a")].find((a) => a.textContent === "Cancel")!.click());
  expect(accept).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(INVITE_KEY)).toBeNull();
});

it("still asks a trusted person before they start helping", async () => {
  const token = `pp_t_trusted${++n}`;
  await open(token);
  expect(accept).not.toHaveBeenCalled();
  await act(async () => button("Accept and help")!.click());
  expect(accept).toHaveBeenCalledWith("/invites/accept", { token });
});
