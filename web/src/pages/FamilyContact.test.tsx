// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import type { ContactView } from "../lib/extended-family";
import { CONTACT_SESSION_KEY } from "../lib/family-contact";
import { FamilyContactPage } from "./FamilyContact";

const t = makeT("en");
const TOKEN = "pp_fi_abc";
const SESSION = "pp_fc_session";
const NOW = new Date("2026-11-19T15:30:00Z");
const confirm = () => globalThis.confirm as unknown as ReturnType<typeof vi.fn>;

const view = (over: Partial<ContactView> = {}): ContactView => ({
  childName: "Sam", name: "Grandma", status: "active", paused: false, canReply: true,
  messages: [
    { id: "m1", from: "child", kind: "quick", text: "Pick me up", sentAt: "2026-11-19T15:00:00Z", receivedAt: "2026-11-19T15:01:00Z" },
    { id: "m2", from: "contact", kind: "reply", text: "On my way", sentAt: "2026-11-19T15:02:00Z", receivedAt: null },
    { id: "m3", from: "contact", kind: "reply", text: "See you", sentAt: "2026-11-19T15:03:00Z", receivedAt: "2026-11-19T15:04:00Z" },
    { id: "m4", from: "child", kind: "snapshot", text: "", sentAt: "2026-11-19T15:10:00Z", receivedAt: null,
      location: { lat: 55.67594, lon: 12.56553, accuracyM: 10, recordedAt: "2026-11-19T15:10:00Z", expiresAt: "2026-11-19T16:10:00Z" } },
  ],
  ...over,
});

interface Call { method: string; url: string; init: RequestInit; body: unknown }
let calls: Call[];
let answers: Record<string, () => Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: NOW });
  calls = [];
  answers = {};
  localStorage.clear();
  window.history.replaceState(null, "", "/family");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers[`${method} ${url.replace("/api/family-contact", "")}`];
    if (!answer) throw new Error(`unexpected ${method} ${url}`);
    return answer();
  }));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<I18nProvider><FamilyContactPage /></I18nProvider>));
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label)!;
  return { container, button, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

it("previews the invitation, and accepting stores the session, clears the hash and loads the conversation", async () => {
  window.history.replaceState(null, "", `/family#invite=${TOKEN}`);
  answers["POST /invite"] = () => json({ childName: "Sam", contactName: "Grandma", childApproved: false, expiresAt: "2026-11-26T10:00:00Z" });
  answers["POST /accept"] = () => json({ session: SESSION });
  answers["GET /me"] = () => json(view());
  const m = await mount();
  expect(m.container.textContent).toContain(t("fc.invited", { child: "Sam", name: "Grandma" }));
  expect(m.container.textContent).toContain(t("fc.childNotYet", { child: "Sam" }));
  expect(localStorage.getItem(CONTACT_SESSION_KEY)).toBeNull();

  await act(async () => m.button(t("fc.accept")).click());
  expect(localStorage.getItem(CONTACT_SESSION_KEY)).toBe(SESSION);
  expect(window.location.hash).toBe("");
  const accept = calls.find((c) => c.url.endsWith("/accept"))!;
  expect(accept.body).toEqual({ token: TOKEN });
  expect(accept.init.credentials).toBe("omit");
  const me = calls.find((c) => c.url.endsWith("/me"))!;
  expect((me.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SESSION}`);
  expect(me.init.credentials).toBe("omit");

  const lines = Array.from(m.container.querySelectorAll(".inbox-message")).map((li) => li.textContent ?? "");
  expect(lines[0]).toContain("Pick me up");
  expect(lines[1]).toContain(t("fc.sent"));
  expect(lines[2]).toContain(t("fc.delivered"));
  expect(lines[3]).toContain(t("ext.snapshot"));
  expect(m.container.querySelector(".inbox-message a")!.getAttribute("href")).toContain("mlat=55.67594");
  expect(m.container.textContent).toContain(t("fc.privacy"));
  await m.unmount();
});

it("declines without storing anything", async () => {
  window.history.replaceState(null, "", `/family#invite=${TOKEN}`);
  answers["POST /invite"] = () => json({ childName: "Sam", contactName: "Grandma", childApproved: true, expiresAt: "2026-11-26T10:00:00Z" });
  answers["POST /decline"] = () => new Response(null, { status: 204 });
  const m = await mount();
  expect(m.container.textContent).toContain(t("fc.childYes", { child: "Sam" }));
  await act(async () => m.button(t("fc.decline")).click());
  expect(m.container.textContent).toContain(t("fc.declined"));
  expect(localStorage.getItem(CONTACT_SESSION_KEY)).toBeNull();
  await m.unmount();
});

it("says a used or expired link is no good", async () => {
  window.history.replaceState(null, "", `/family#invite=${TOKEN}`);
  answers["POST /invite"] = () => json({ error: "gone" }, 410);
  const m = await mount();
  expect(m.container.querySelector('[role="alert"]')!.textContent).toBe(t("fc.linkUsed"));
  await m.unmount();
});

it("says what is missing when there is no link and no session", async () => {
  const m = await mount();
  expect(m.container.querySelector('[role="alert"]')!.textContent).toBe(t("fc.missing"));
  await m.unmount();
});

it("clears the session on a 401 and tells the person to ask for a new link", async () => {
  localStorage.setItem(CONTACT_SESSION_KEY, SESSION);
  answers["GET /me"] = () => json({ error: "unauthorized" }, 401);
  const m = await mount();
  expect(localStorage.getItem(CONTACT_SESSION_KEY)).toBeNull();
  expect(m.container.querySelector('[role="alert"]')!.textContent).toBe(t("fc.sessionGone"));
  await m.unmount();
});

it("posts a reply, polls every 30 seconds, and pauses and waiting states hide the reply box", async () => {
  localStorage.setItem(CONTACT_SESSION_KEY, SESSION);
  let current = view();
  answers["GET /me"] = () => json(current);
  answers["POST /me/messages"] = () => json({ id: "m9" }, 201);
  const m = await mount();
  const input = m.container.querySelector<HTMLInputElement>("input")!;
  expect(input.maxLength).toBe(60);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " Thank you ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { m.container.querySelector("form")!.requestSubmit(); });
  expect(calls.find((c) => c.method === "POST")!.body).toEqual({ text: "Thank you" });

  const gets = () => calls.filter((c) => c.method === "GET").length;
  const before = gets();
  current = view({ paused: true, canReply: false });
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(gets()).toBe(before + 1);
  expect(m.container.textContent).toContain(t("fc.paused"));
  expect(m.container.querySelector("form")).toBeNull();

  current = view({ canReply: false, status: "waitingForChild" });
  await act(async () => { vi.advanceTimersByTime(30_000); });
  expect(m.container.textContent).toContain(t("fc.waitingChild", { child: "Sam" }));
  await m.unmount();
});

it("leaves after a confirmation and forgets the session", async () => {
  localStorage.setItem(CONTACT_SESSION_KEY, SESSION);
  answers["GET /me"] = () => json(view());
  answers["DELETE /me"] = () => new Response(null, { status: 204 });
  const m = await mount();
  await act(async () => m.button(t("fc.leave")).click());
  expect(confirm()).toHaveBeenCalledWith(t("fc.leaveConfirm", { child: "Sam" }));
  expect(localStorage.getItem(CONTACT_SESSION_KEY)).toBeNull();
  expect(m.container.textContent).toContain(t("fc.left"));
  await m.unmount();
});
