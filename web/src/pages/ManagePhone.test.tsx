// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import type { Phone } from "../lib/api";
import { ManagePhone, PhoneLayout } from "./Phone";

const PID = "phone-1";
const basePhone = {
  id: PID, name: "Test phone", profile: "child", mode: "strong", timezone: "Europe/Copenhagen",
  locationEnabled: false, pairedAt: "2026-11-01T10:00:00Z", releaseRequestedAt: null, lastSeenAt: "2026-11-20T11:59:00Z",
  dnsHost: null, dnsSynced: true, dnsReady: true, hasLocation: false, status: null, openRequests: 0,
  offlineAlertHours: null, offlineAlertHoursDefault: 24,
} as Phone;

let phone: Phone;
let calls: string[];
let answer: (method: string, path: string) => Response | undefined;
let root: Root;
let container: HTMLElement;
let path = "";

function Where() {
  path = useLocation().pathname;
  return null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  phone = { ...basePhone };
  calls = [];
  answer = () => undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const p = url.replace(/^\/api/, "");
    calls.push(`${method} ${p}`);
    const custom = answer(method, p);
    if (custom) return custom;
    if (p === `/phones/${PID}` && method === "GET") return Response.json(phone);
    if (p === `/phones/${PID}/changes`) return Response.json({ changes: [] });
    return Response.json({});
  }));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter initialEntries={[`/phones/${PID}/manage`]}>
      <I18nProvider>
        <Routes>
          <Route path="/phones/:pid" element={<PhoneLayout />}>
            <Route path="manage" element={<ManagePhone />} />
          </Route>
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </I18nProvider>
    </MemoryRouter>,
  ));
  await act(async () => undefined);
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);
const writes = () => calls.filter((c) => !c.startsWith("GET"));

it("releases a phone only after the question is answered, and leaves once it is gone", async () => {
  answer = (method, p) => {
    if (method === "POST" && p === `/phones/${PID}/release`) return Response.json({ status: "applied" });
    // The server forgets a released phone that has never reported since.
    if (method === "GET" && p === `/phones/${PID}` && writes().length) return Response.json({ error: "not found" }, { status: 404 });
    return undefined;
  };
  await mount();
  await act(async () => button("Release the phone")!.click());
  expect(writes()).toEqual([]);
  expect(container.textContent).toContain("Release this phone?");
  expect(document.activeElement?.id).toBe("danger-q");

  await act(async () => button("Cancel")!.click());
  expect(writes()).toEqual([]);

  await act(async () => button("Release the phone")!.click());
  await act(async () => button("Yes, release")!.click());
  await act(async () => undefined);
  expect(writes()).toEqual([`POST /phones/${PID}/release`]);
  expect(path).toBe("/");
});

it("removes a phone after the question and goes back to the list", async () => {
  answer = (method, p) => method === "DELETE" && p === `/phones/${PID}` ? Response.json({ status: "applied" }) : undefined;
  await mount();
  await act(async () => button("Remove this phone")!.click());
  expect(writes()).toEqual([]);
  await act(async () => button("Yes, remove")!.click());
  await act(async () => undefined);
  expect(writes()).toEqual([`DELETE /phones/${PID}`]);
  expect(path).toBe("/");
});

it("keeps a Self phone in place while its removal waits for the key", async () => {
  phone = { ...basePhone, profile: "self" };
  answer = (method) => method === "DELETE"
    ? Response.json({ status: "pending", change: { id: "c1", kind: "remove", summary: { en: "Remove the phone", da: "Fjern telefonen" }, applyAt: "2026-11-21T12:00:00Z", createdAt: "2026-11-20T12:00:00Z" } }, { status: 202 })
    : undefined;
  await mount();
  await act(async () => button("Remove this phone")!.click());
  expect(container.textContent).toContain("Removal waits for your key.");
  await act(async () => button("Yes, remove")!.click());
  await act(async () => undefined);
  expect(writes()).toEqual([`DELETE /phones/${PID}`]);
  expect(path).toBe(`/phones/${PID}/manage`);
});

it("shows the error and stays when the release fails", async () => {
  answer = (method) => method === "POST" ? Response.json({ error: "boom" }, { status: 500 }) : undefined;
  await mount();
  await act(async () => button("Release the phone")!.click());
  await act(async () => button("Yes, release")!.click());
  await act(async () => undefined);
  expect(path).toBe(`/phones/${PID}/manage`);
  expect(container.querySelector('[role="alert"], .notice-error')).not.toBeNull();
  // The danger buttons are usable again.
  expect(button("Release the phone")?.disabled).toBe(false);
});
