// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { ApiError, api } from "../lib/api";
import { SosOptions } from "./SosOptions";

const t = makeT("en");
const PID = "p1";
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const message = (n: number, text: string, meansSos = false) => ({ id: ID(n), text, meansSos, createdAt: "2026-11-19T10:00:00Z" });

interface Server {
  settings: Record<string, unknown>;
  messages: ReturnType<typeof message>[];
  suggestions: { id: string; text: string; createdAt: string }[];
}

const calls: { method: string; path: string; body?: unknown }[] = [];

/** A tiny in-memory stand-in for the parent endpoints of one phone. */
function serve(server: Server, failWith?: ApiError) {
  const record = (method: string) => async (path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (failWith && method !== "GET") throw failWith;
    return undefined;
  };
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    calls.push({ method: "GET", path });
    if (path === `/phones/${PID}/sos`) return { events: [], callbackNumber: null, settings: server.settings } as never;
    if (path === `/phones/${PID}/extended`) return { enabled: false, locationSnapshots: false, contacts: [] } as never;
    return { messages: server.messages, suggestions: server.suggestions } as never;
  });
  vi.spyOn(api, "put").mockImplementation(record("PUT") as never);
  vi.spyOn(api, "post").mockImplementation(record("POST") as never);
  vi.spyOn(api, "patch").mockImplementation(record("PATCH") as never);
  vi.spyOn(api, "del").mockImplementation(record("DELETE") as never);
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<I18nProvider><SosOptions pid={PID} /></I18nProvider>));
  const sw = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'))
    .find((b) => document.getElementById(b.getAttribute("aria-labelledby")!)?.textContent === label);
  const button = (name: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
  const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click());
  const type = (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = (form: HTMLFormElement) => act(async () => { form.requestSubmit(); });
  return { container, sw, button, click, type, submit, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const empty = (): Server => ({ settings: {}, messages: [], suggestions: [] });
const puts = () => calls.filter((c) => c.method === "PUT");

it("shows the defaults: hidden options, quick messages and the family inbox off, and the child-sees-it sentence", async () => {
  serve(empty());
  const m = await mount();
  expect(m.sw(t("hidden.power"))!.getAttribute("aria-checked")).toBe("false");
  expect(m.sw(t("hidden.clock"))!.getAttribute("aria-checked")).toBe("false");
  expect(m.sw(t("qm.enabled"))!.getAttribute("aria-checked")).toBe("false");
  expect(m.sw(t("qm.suggest"))!.getAttribute("aria-checked")).toBe("true");
  expect(m.sw(t("inbox.enabled"))!.getAttribute("aria-checked")).toBe("false");
  expect(m.sw(t("inbox.checkIns"))!.getAttribute("aria-checked")).toBe("false");
  expect(m.container.textContent).toContain(t("hidden.powerHelp"));
  expect(m.container.textContent).toContain(t("hidden.visible"));
  // Choices that only matter once a hidden option is on stay out of sight.
  expect(m.container.querySelector('[role="radiogroup"]')).toBeNull();
  await m.unmount();
});

it("saves each switch with the right PUT body", async () => {
  serve(empty());
  const m = await mount();
  await m.click(m.sw(t("hidden.power")));
  await m.click(m.sw(t("hidden.clock")));
  await m.click(m.sw(t("qm.enabled")));
  await m.click(m.sw(t("qm.suggest")));
  await m.click(m.sw(t("inbox.checkIns")));
  expect(puts().map((c) => c.body)).toEqual([
    { hiddenPower: true }, { hiddenClock: true }, { quickMessagesEnabled: true }, { quickSuggestionsEnabled: false }, { checkIns: true },
  ]);
  expect(m.sw(t("hidden.power"))!.getAttribute("aria-checked")).toBe("true");
  expect(m.sw(t("qm.enabled"))!.getAttribute("aria-checked")).toBe("true");
  expect(m.sw(t("inbox.checkIns"))!.getAttribute("aria-checked")).toBe("true");
  await m.unmount();
});

it("offers 3 to 6 presses with 4 chosen and the Android 12 note once the power button is on", async () => {
  serve({ ...empty(), settings: { hiddenPower: true } });
  const m = await mount();
  const radios = Array.from(m.container.querySelectorAll<HTMLInputElement>('[role="radiogroup"] input[name="presses-p1"]'));
  expect(radios.map((r) => r.value)).toEqual(["3", "4", "5", "6"]);
  expect(radios.find((r) => r.checked)!.value).toBe("4");
  expect(m.container.textContent).toContain(t("hidden.pressesHelp"));
  await act(async () => radios[2]!.click());
  expect(puts().at(-1)!.body).toEqual({ hiddenPresses: 5 });
  await m.unmount();
});

it("shows the quiet confirmation choice only while a hidden option is on, and saves it", async () => {
  serve({ ...empty(), settings: { hiddenClock: true } });
  const m = await mount();
  const none = m.container.querySelector<HTMLInputElement>('input[name="feedback-p1"][value="none"]')!;
  expect(m.container.querySelector<HTMLInputElement>('input[name="feedback-p1"][value="vibrate"]')!.checked).toBe(true);
  await act(async () => none.click());
  expect(puts().at(-1)!.body).toEqual({ hiddenFeedback: "none" });
  await m.click(m.sw(t("hidden.clock")));
  expect(m.container.querySelector('input[name="feedback-p1"]')).toBeNull();
  await m.unmount();
});

it("tells the parent when a switch could not be saved, and keeps the old value", async () => {
  serve(empty(), new ApiError(500, "boom"));
  const m = await mount();
  await m.click(m.sw(t("hidden.power")));
  expect(m.container.querySelector('[role="alert"]')!.textContent).toBe(t("hidden.error"));
  expect(m.sw(t("hidden.power"))!.getAttribute("aria-checked")).toBe("false");
  await m.unmount();
});

it("offers the three starter messages while the list is empty, each added with one tap", async () => {
  serve(empty());
  const m = await mount();
  expect(m.container.textContent).toContain(t("qm.emptyIntro"));
  for (const key of ["qm.pick1", "qm.pick2", "qm.pick3"] as const) expect(m.button(t(key))).toBeTruthy();
  await m.click(m.button("I’m okay"));
  expect(calls.find((c) => c.method === "POST")).toEqual({ method: "POST", path: `/phones/${PID}/quick-messages`, body: { text: "I’m okay", meansSos: false } });
  await m.unmount();
});

it("lists the messages, marks code words and leaves out the starters", async () => {
  serve({ ...empty(), messages: [message(1, "Pick me up"), message(2, "Pizza tonight?", true)] });
  const m = await mount();
  expect(m.container.textContent).toContain("Pick me up");
  expect(m.container.textContent).toContain(t("qm.list", { n: 2, max: 6 }));
  expect(m.container.querySelectorAll(`[data-message="${ID(2)}"] .row-meta`)[0]!.textContent).toBe(t("qm.codeBadge"));
  expect(m.container.querySelector(`[data-message="${ID(1)}"] .row-meta`)).toBeNull();
  expect(m.container.textContent).not.toContain(t("qm.emptyIntro"));
  await m.unmount();
});

it("adds a message as a code word with the explanation next to the switch", async () => {
  serve(empty());
  const m = await mount();
  expect(m.container.textContent).toContain(t("qm.codeHelp"));
  const form = m.container.querySelector<HTMLFormElement>("form")!;
  await m.type(form.querySelector("input")!, "  Pizza tonight?  ");
  await m.click(m.sw(t("qm.code")));
  await m.submit(form);
  expect(calls.find((c) => c.method === "POST")!.body).toEqual({ text: "Pizza tonight?", meansSos: true });
  await m.unmount();
});

it("edits a message with PATCH and deletes another", async () => {
  serve({ ...empty(), messages: [message(1, "Pick me up"), message(2, "Call me")] });
  const m = await mount();
  await m.click(m.button(t("qm.editLabel", { text: "Pick me up" })));
  const form = Array.from(m.container.querySelectorAll<HTMLFormElement>("form"))[0]!;
  expect(form.querySelector("input")!.value).toBe("Pick me up");
  await m.type(form.querySelector("input")!, "Pick me up at 5");
  await m.click(m.sw(t("qm.code")));
  await m.submit(form);
  expect(calls.find((c) => c.method === "PATCH")).toEqual({
    method: "PATCH", path: `/phones/${PID}/quick-messages/${ID(1)}`, body: { text: "Pick me up at 5", meansSos: true },
  });
  await m.click(m.button(t("qm.deleteLabel", { text: "Call me" })));
  expect(calls.find((c) => c.method === "DELETE")!.path).toBe(`/phones/${PID}/quick-messages/${ID(2)}`);
  await m.unmount();
});

it("stops offering to add at six messages", async () => {
  serve({ ...empty(), messages: [1, 2, 3, 4, 5, 6].map((n) => message(n, `Message ${n}`)) });
  const m = await mount();
  expect(Array.from(m.container.querySelectorAll("form")).filter((f) => !f.closest("#callback-settings"))).toEqual([]);
  expect(m.container.textContent).toContain(t("qm.max", { max: 6, chars: 60 }));
  await m.unmount();
});

it("shows a suggestion from the child and approves, approves as code word or declines it", async () => {
  const suggestions = [1, 2, 3].map((n) => ({ id: ID(n), text: `Idea ${n}`, createdAt: "2026-11-19T10:00:00Z" }));
  serve({ ...empty(), suggestions });
  const m = await mount();
  // Waiting suggestions open the section and show in its title.
  expect(m.container.querySelectorAll("details")[1]!.open).toBe(true);
  expect(m.container.querySelectorAll("summary")[1]!.textContent).toBe("Quick messages (3)");
  const inRow = (n: number, label: string) => Array.from(m.container.querySelectorAll(`[data-suggestion="${ID(n)}"] button`))
    .find((b) => b.textContent === label);
  await m.click(inRow(1, t("qm.approve")));
  await m.click(inRow(2, t("qm.approveCode")));
  await m.click(inRow(3, t("qm.decline")));
  const posts = calls.filter((c) => c.method === "POST");
  expect(posts).toEqual([
    { method: "POST", path: `/phones/${PID}/quick-messages/${ID(1)}/approve`, body: { meansSos: false } },
    { method: "POST", path: `/phones/${PID}/quick-messages/${ID(2)}/approve`, body: { meansSos: true } },
    { method: "POST", path: `/phones/${PID}/quick-messages/${ID(3)}/decline`, body: undefined },
  ]);
  await m.unmount();
});

it("says so when six messages already exist on approval", async () => {
  serve({ ...empty(), suggestions: [{ id: ID(1), text: "Idea", createdAt: "2026-11-19T10:00:00Z" }] }, new ApiError(409, "full"));
  const m = await mount();
  await m.click(Array.from(m.container.querySelectorAll("button")).find((b) => b.textContent === t("qm.approve")));
  expect(m.container.querySelector('[role="alert"]')!.textContent).toBe(t("qm.full", { max: 6 }));
  await m.unmount();
});

// Synthetic number.
const CALLBACK = "+4500000001";

it("keeps Ask for a callback off and unusable until the number is confirmed, then saves number and confirmation together", async () => {
  serve(empty());
  const m = await mount();
  const sw = () => m.sw(t("cb.title"))!;
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(sw().disabled).toBe(true);
  expect(m.container.textContent).toContain(t("cb.help"));
  expect(m.container.textContent).toContain(t("cb.needNumber"));
  const input = m.container.querySelector<HTMLInputElement>('#callback-settings input[type="tel"]')!;
  const sure = m.container.querySelector<HTMLInputElement>('#callback-settings input[type="checkbox"]')!;
  const save = m.button(t("cb.saveNumber"))!;
  await m.type(input, CALLBACK);
  // Typing is not enough: the parent has to say it is the phone's number.
  expect(save.disabled).toBe(true);
  await m.click(sure);
  expect(save.disabled).toBe(false);
  await m.submit(input.form!);
  expect(puts().map((c) => c.body)).toEqual([{ callbackNumber: CALLBACK, callbackConfirmed: true }]);
  await m.unmount();
});

it("turns Ask for a callback on with the right PUT body once the number is confirmed", async () => {
  serve({ ...empty(), settings: { callbackConfirmed: true } });
  const m = await mount();
  expect(m.sw(t("cb.title"))!.disabled).toBe(false);
  await m.click(m.sw(t("cb.title")));
  expect(puts().map((c) => c.body)).toEqual([{ callbackRequests: true }]);
  await m.unmount();
});

it("stops offering Call me as a text-only starter while callbacks are on", async () => {
  serve({ ...empty(), settings: { callbackConfirmed: true, callbackRequests: true, quickMessagesEnabled: true } });
  const m = await mount();
  expect(m.button(t("qm.pick1"))).toBeDefined();
  expect(m.button(t("qm.pick3"))).toBeUndefined();
  await m.unmount();
});
