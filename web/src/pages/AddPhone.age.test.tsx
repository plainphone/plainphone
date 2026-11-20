// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
//
// The two optional Child-phone steps of /add: where the rules start, and the family agreement.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { AddPhonePage } from "./AddPhone";

const phone = { id: "test-phone", name: "Test phone", mode: "light", pairedAt: null, setupEnrollmentId: "e1" };
const provisioning = {
  mode: "light", profile: "child", timezone: "UTC", serverUrl: "https://my-plainphone.example.org",
  adminComponent: "org.plainphone.app/.PlainphoneAdminReceiver", downloadUrl: "https://my-plainphone.example.org/download/android",
  signatureChecksum: "test-checksum", dnsHost: "dns.example.org",
};
const presets = [
  { id: "8-9", dailyMinutes: { weekday: 60, weekend: 90 }, bedtime: { startMinute: 1170, endMinute: 420 }, school: null, blockedCategories: ["social"] },
  { id: "10-11", dailyMinutes: { weekday: 90, weekend: 120 }, bedtime: { startMinute: 1230, endMinute: 420 }, school: null, blockedCategories: ["adult"] },
];

async function run(fill: (container: HTMLElement) => Promise<void>, failPreset = false) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    calls.push({ method: request.method!, url, body: request.body ? JSON.parse(request.body as string) : undefined });
    if (url === "/api/age-presets") return Response.json({ presets });
    if (request.method === "GET") return Response.json(phone);
    if (url === "/api/phones/enroll") {
      return Response.json({ phone, enrollment: { id: "e1", token: "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, provisioning }, { status: 201 });
    }
    if (failPreset && url.endsWith("/age-preset")) return Response.json({ error: "no" }, { status: 500 });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={["/add?mode=light"]}><I18nProvider><AddPhonePage /></I18nProvider></MemoryRouter>,
    ));
    const field = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Test phone");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLFormElement>("form")!.requestSubmit());
    await fill(container);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    return { calls, text: container.textContent ?? "" };
  } finally {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("pp.locale");
    vi.unstubAllGlobals();
  }
}

const button = (container: HTMLElement, label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
const type = (el: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

it("saves the chosen age, the review reminder and the agreement on the new phone", async () => {
  const { calls } = await run(async (c) => {
    // Step 2: age. The review reminder is on by default, every 3 months.
    await act(async () => c.querySelector<HTMLInputElement>('input[name="age"][value="10-11"]')!.click());
    await act(async () => button(c, "Continue").click());
    // Step 3: the agreement.
    const [lines, adults] = c.querySelectorAll("textarea");
    await act(async () => type(lines!, "I put the phone away at dinner\n\nI ask before I install apps"));
    await act(async () => type(adults!, "Adults leave the phone in the hall at dinner"));
    await act(async () => button(c, "Create setup link").click());
  });
  const after = calls.filter((c) => c.method !== "GET");
  expect(after.map((c) => `${c.method} ${c.url}`)).toEqual([
    "POST /api/phones/enroll",
    "POST /api/phones/test-phone/age-preset",
    "PUT /api/phones/test-phone/review",
    "PUT /api/phones/test-phone/agreement",
  ]);
  expect(after[1]!.body).toEqual({ preset: "10-11" });
  expect(after[2]!.body).toEqual({ enabled: true, intervalMonths: 3 });
  expect(after[3]!.body).toEqual({
    lines: ["I put the phone away at dinner", "I ask before I install apps"],
    adultLines: ["Adults leave the phone in the hall at dinner"],
  });
});

it("changes nothing on the phone when both steps are skipped and the reminder is off", async () => {
  const { calls } = await run(async (c) => {
    await act(async () => c.querySelector<HTMLButtonElement>('button[role="switch"]')!.click());
    await act(async () => button(c, "Continue").click());
    await act(async () => button(c, "Create setup link").click());
  });
  expect(calls.filter((c) => c.method !== "GET").map((c) => c.url)).toEqual(["/api/phones/enroll"]);
});

it("still shows the code, with a note, when a choice could not be saved", async () => {
  const { text } = await run(async (c) => {
    await act(async () => c.querySelector<HTMLInputElement>('input[name="age"][value="8-9"]')!.click());
    await act(async () => button(c, "Continue").click());
    await act(async () => button(c, "Create setup link").click());
  }, true);
  expect(text).toContain("not everything you chose could be saved");
  expect(text).toContain("Open setup link");
});

it("will not go on while a line is too long", async () => {
  await run(async (c) => {
    await act(async () => button(c, "Continue").click());
    const [lines] = c.querySelectorAll("textarea");
    await act(async () => type(lines!, "x".repeat(141)));
    expect(c.textContent).toContain("Keep each line under 140 characters.");
    expect(button(c, "Create setup link").disabled).toBe(true);
  });
});
