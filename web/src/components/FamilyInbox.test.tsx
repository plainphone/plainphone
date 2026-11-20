// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { ApiError, api } from "../lib/api";
import { DEFAULT_SOS_SETTINGS, type FamilyInboxThread, type SosSettings } from "../lib/sos-options";
import { FamilyInbox } from "./FamilyInbox";

const t = makeT("en");
const PID = "p1";
const thread = (): FamilyInboxThread => ({
  familyInbox: true, quickMessages: true, checkIns: true, recipients: ["Alex"],
  messages: [
    { id: "a", from: "child", kind: "quick", text: "Pick me up", sentAt: "2026-11-19T15:00:00Z", delivered: 2 },
    { id: "b", from: "child", kind: "checkin", text: "Jeg er hjemme", sentAt: "2026-11-19T15:05:00Z", delivered: 0 },
    { id: "c", from: "parent", kind: "reply", text: "On my way", sentAt: "2026-11-19T15:06:00Z", author: "Alex", receivedAt: null },
  ],
});

const posts: unknown[] = [];
// The thread, and an extended family roster with nobody on it (it shows only with people on it).
const mockThread = () => vi.spyOn(api, "get").mockImplementation((async (path: string) =>
  path.endsWith("/extended") ? { enabled: false, locationSnapshots: false, contacts: [] } : thread()) as never);

beforeEach(() => {
  posts.length = 0;
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(settings: Partial<SosSettings>, onSetting = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <I18nProvider>
      <FamilyInbox pid={PID} settings={{ ...DEFAULT_SOS_SETTINGS, ...settings }} saving={false} onSetting={onSetting} />
    </I18nProvider>,
  ));
  const input = (label: string) => {
    const l = Array.from(container.querySelectorAll("label")).find((x) => x.textContent?.startsWith(label))!;
    return container.querySelector<HTMLInputElement>(`#${CSS.escape(l.htmlFor)}`)!;
  };
  const type = (el: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = () => act(async () => { container.querySelector("form")!.requestSubmit(); });
  return { container, input, type, submit, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

it("keeps the thread out of sight while the inbox is off, and says check-ins need it", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ enabled: false, locationSnapshots: false, contacts: [] } as never);
  const onSetting = vi.fn();
  const m = await mount({}, onSetting);
  expect(get).not.toHaveBeenCalledWith(`/phones/${PID}/inbox`);
  expect(m.container.querySelector("form")).toBeNull();
  expect(m.container.textContent).toContain(t("inbox.needsInbox"));
  expect(m.container.textContent).toContain(t("inbox.privacy"));
  const inbox = Array.from(m.container.querySelectorAll<HTMLButtonElement>('[role="switch"]'))[0]!;
  await act(async () => inbox.click());
  expect(onSetting).toHaveBeenCalledWith({ familyInbox: true });
  await m.unmount();
});

it("shows each message with who sent it and where it is, in the parent's language", async () => {
  mockThread();
  const m = await mount({ familyInbox: true });
  const items = Array.from(m.container.querySelectorAll(".inbox-message")).map((li) => li.textContent);
  expect(items[0]).toContain("Pick me up");
  expect(items[0]).toContain(t("inbox.delivered"));
  // A check-in reads in the parent's language, whatever the phone's.
  expect(items[1]).toContain(t("inbox.checkIn"));
  expect(items[1]).toContain(t("inbox.sms"));
  expect(items[2]).toContain("Alex");
  expect(items[2]).toContain(t("inbox.waiting"));
  await m.unmount();
});

it("sends a short reply with the remembered name, and explains a switched-off inbox", async () => {
  mockThread();
  const post = vi.spyOn(api, "post").mockImplementation(async (path: string, body?: unknown) => {
    posts.push({ path, body });
    return {} as never;
  });
  const m = await mount({ familyInbox: true });
  await m.type(m.input(t("inbox.replyLabel")), " On my way ");
  await m.type(m.input(t("inbox.replyName")), "Alex");
  await m.submit();
  expect(posts).toEqual([{ path: `/phones/${PID}/inbox`, body: { text: "On my way", name: "Alex" } }]);
  expect(localStorage.getItem("pp.inboxName")).toBe("Alex");
  expect(m.input(t("inbox.replyLabel")).value).toBe("");

  post.mockRejectedValueOnce(new ApiError(403, "off"));
  await m.type(m.input(t("inbox.replyLabel")), "Dinner at 18");
  await m.submit();
  expect(m.container.querySelector('[role="alert"]')!.textContent).toBe(t("inbox.off"));
  await m.unmount();
});
