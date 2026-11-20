// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { INVITE_KEY, LINK_ASKED_KEY, NEXT_KEY, SessionProvider, useHouseholdId, useSession } from "./session";

vi.mock("./push", () => ({ PUSH_ID_KEY: "pp_push_id", disablePush: async () => undefined }));

const me = {
  user: { id: "u1", email: "parent@example.org", locale: "en" },
  households: [{ id: "h-own", name: "Home", role: "owner" }, { id: "h-other", name: "Other", role: "parent" }],
  mailEnabled: true,
};

let root: Root;
let container: HTMLElement;
let logoutStatus: number | "offline";
let view: ReturnType<typeof useSession>;
let householdId: string | undefined;

function Probe() {
  view = useSession();
  householdId = useHouseholdId();
  return <p>{view.state.status}</p>;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  logoutStatus = 204;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/me") return Response.json(me);
    if (url === "/api/auth/logout") {
      if (logoutStatus === "offline") throw new TypeError("Failed to fetch");
      return new Response(logoutStatus === 204 ? null : JSON.stringify({ error: "x" }), { status: logoutStatus });
    }
    return new Response(null, { status: 404 });
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<I18nProvider><SessionProvider><Probe /></SessionProvider></I18nProvider>));
  await act(async () => undefined);
}

function keepAccountState() {
  sessionStorage.setItem(NEXT_KEY, "/phones/p1");
  sessionStorage.setItem(INVITE_KEY, "pp_i_left_behind");
  localStorage.setItem("pp.inboxName", "Parent");
  localStorage.setItem(LINK_ASKED_KEY, "1");
}

it("stays signed in and says so when the server could not end the session", async () => {
  await mount();
  expect(view.state.status).toBe("in");
  keepAccountState();
  logoutStatus = "offline";
  await act(async () => {
    await expect(view.logout()).rejects.toThrow();
  });
  // The HttpOnly cookie still works, so showing the login page would be a lie on a shared tablet.
  expect(view.state.status).toBe("in");

  logoutStatus = 500;
  await act(async () => {
    await expect(view.logout()).rejects.toThrow();
  });
  expect(view.state.status).toBe("in");
});

it("forgets this account's destination, invitation and inbox name after logging out", async () => {
  await mount();
  keepAccountState();
  await act(async () => view.logout());
  expect(view.state).toEqual({ status: "anon", signedOut: true });
  expect(sessionStorage.getItem(NEXT_KEY)).toBeNull();
  expect(sessionStorage.getItem(INVITE_KEY)).toBeNull();
  expect(localStorage.getItem("pp.inboxName")).toBeNull();
  expect(localStorage.getItem(LINK_ASKED_KEY)).toBeNull();
});

it("treats an already expired session as logged out", async () => {
  await mount();
  logoutStatus = 401;
  await act(async () => view.logout());
  expect(view.state.status).toBe("anon");
});

it("puts new phones in the household the Household page shows", async () => {
  await mount();
  expect(householdId).toBe("h-own");
});
