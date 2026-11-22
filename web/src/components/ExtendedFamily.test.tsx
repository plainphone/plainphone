// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { api } from "../lib/api";
import { type ExtendedContact, type ExtendedRoster, snapshotUntil } from "@plainphone/shared/extended-family";
import { DEFAULT_SOS_SETTINGS, type FamilyInboxThread, type SosSettings } from "@plainphone/shared/sos-options";
import { FamilyInbox } from "./FamilyInbox";

const t = makeT("en");
const PID = "p1";
const LINK = "https://plainphone.example/family#invite=pp_fi_secret";
const contact = (id: string, name: string, status: ExtendedContact["status"], group: ExtendedContact["group"] = "others"): ExtendedContact => ({
  id, name, group, status, childApproved: status === "active", contactAccepted: status === "active",
  linkExpiresAt: null, createdAt: "2026-11-01T10:00:00Z",
});
const STATES = [
  contact("c1", "Grandma", "waitingForChild"),
  contact("c2", "Uncle Joe", "waitingForContact"),
  contact("c3", "Cousin Kim", "active", "family"),
  contact("c4", "Neighbour", "blocked"),
  contact("c5", "Friend A", "declinedByChild"),
  contact("c6", "Friend B", "declinedByContact"),
  contact("c7", "Friend C", "expired"),
];
const SNAPSHOT_END = "2026-11-19T16:40:00Z";
const inbox = (messages: FamilyInboxThread["messages"] = []): FamilyInboxThread => ({
  familyInbox: true, quickMessages: true, checkIns: false, recipients: ["Alex"], messages,
});

let roster: ExtendedRoster;
let thread: FamilyInboxThread;
const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  roster = { enabled: true, locationSnapshots: false, contacts: STATES };
  thread = inbox();
  writeText.mockClear();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"], clipboard: { writeText } });
  vi.spyOn(api, "get").mockImplementation((async (path: string) =>
    path.endsWith("/extended") ? roster : thread) as never);
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
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;
  const type = (el: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { container, button, type, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const switches = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('[role="switch"]'));

it("has two switches that save through the settings patch, and says they need the inbox", async () => {
  roster = { enabled: false, locationSnapshots: false, contacts: [] };
  const onSetting = vi.fn();
  const m = await mount({}, onSetting);
  expect(m.container.textContent).toContain(`${t("ext.switchHelp")} ${t("inbox.needsInbox")}`);
  expect(m.container.textContent).toContain(`${t("ext.snapSwitchHelp")} ${t("inbox.needsInbox")}`);
  const [, , ext, snap] = switches(m.container);
  expect(ext!.getAttribute("aria-checked")).toBe("false");
  await act(async () => ext!.click());
  await act(async () => snap!.click());
  expect(onSetting).toHaveBeenNthCalledWith(1, { extendedFamily: true });
  expect(onSetting).toHaveBeenNthCalledWith(2, { locationSnapshots: true });
  // Off with nobody on the list: no roster and no invite form.
  expect(m.container.querySelector(`section[aria-label="${t("ext.title")}"]`)).toBeNull();
  expect(m.container.querySelector('input[maxlength="40"]')).toBeNull();
  await m.unmount();
});

it("keeps the roster visible while paused, to remove people, without inviting or new links", async () => {
  roster = { enabled: false, locationSnapshots: false, contacts: STATES };
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined as never);
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  const m = await mount({ familyInbox: true, extendedFamily: false });
  expect(m.container.textContent).toContain(t("ext.paused"));
  expect(m.container.querySelectorAll("[data-contact]")).toHaveLength(STATES.length);
  expect(m.container.querySelector(`button[aria-label^="${t("ext.newLink")}"]`)).toBeNull();
  expect(m.container.querySelector('input[maxlength="40"]')).toBeNull();
  await act(async () => m.button(`${t("ext.remove")}: Neighbour`).click());
  expect(del).toHaveBeenCalledWith(`/phones/${PID}/extended/c4`);
  await m.unmount();
});

it("shows each person with a plain-language state, and a new link only where it makes sense", async () => {
  const m = await mount({ familyInbox: true, extendedFamily: true });
  const rows = Object.fromEntries(Array.from(m.container.querySelectorAll("[data-contact]")).map((li) => [li.getAttribute("data-contact"), li.textContent ?? ""]));
  expect(rows.c1).toContain("Grandma");
  expect(rows.c1).toContain(t("ext.state.waitingForChild"));
  expect(rows.c2).toContain("Waiting for Uncle Joe to accept the link");
  expect(rows.c3).toContain(t("ext.state.active"));
  expect(rows.c4).toContain("Blocked by your child");
  expect(rows.c5).toContain(t("ext.state.declinedByChild"));
  expect(rows.c6).toContain("Friend B said no");
  expect(rows.c7).toContain(t("ext.state.expired"));
  const renewable = (id: string) => m.container.querySelector(`[data-contact="${id}"] button[aria-label^="${t("ext.newLink")}"]`);
  expect([1, 2, 3, 4, 5, 6, 7].map((n) => renewable(`c${n}`) !== null)).toEqual([true, true, true, false, false, true, true]);
  expect(m.container.textContent).toContain(t("ext.intro"));
  expect(m.container.textContent).toContain(t("ext.newLinkHelp"));
  await m.unmount();
});

it("shows the single-use link once, with a copy button", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({
    contact: contact("c9", "Aunt May", "waitingForChild"), link: LINK, expiresAt: "2026-11-27T10:00:00Z",
  } as never);
  const m = await mount({ familyInbox: true, extendedFamily: true });
  expect(m.container.textContent).not.toContain(LINK);
  await m.type(m.container.querySelector<HTMLInputElement>('input[maxlength="40"]')!, " Aunt May ");
  await act(async () => { Array.from(m.container.querySelectorAll("form")).at(-1)!.requestSubmit(); });
  expect(post).toHaveBeenCalledWith(`/phones/${PID}/extended`, { name: "Aunt May" });
  expect(m.container.querySelector<HTMLInputElement>(`input[value="${LINK}"]`)).not.toBeNull();
  expect(m.container.textContent).toContain("It works once, for 7 days");
  await act(async () => m.button(t("ext.copy")).click());
  expect(writeText).toHaveBeenCalledWith(LINK);
  expect(m.container.textContent).toContain(t("ext.copied"));
  await act(async () => m.button(t("ext.done")).click());
  expect(m.container.querySelector(`input[value="${LINK}"]`)).toBeNull();
  await m.unmount();
});

it("asks a person for a new link, removes with a confirmation, and changes the contact group", async () => {
  const post = vi.spyOn(api, "post").mockResolvedValue({ contact: STATES[0], link: LINK, expiresAt: "2026-11-27T10:00:00Z" } as never);
  const del = vi.spyOn(api, "del").mockResolvedValue(undefined as never);
  const patch = vi.spyOn(api, "patch").mockResolvedValue({} as never);
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal("confirm", confirm);
  const m = await mount({ familyInbox: true, extendedFamily: true });

  await act(async () => m.button(`${t("ext.newLink")}: Grandma`).click());
  expect(post).toHaveBeenCalledWith(`/phones/${PID}/extended/c1/link`);

  await act(async () => m.button(`${t("ext.remove")}: Grandma`).click());
  expect(del).not.toHaveBeenCalled();
  await act(async () => m.button(`${t("ext.remove")}: Grandma`).click());
  expect(confirm).toHaveBeenLastCalledWith(t("ext.removeConfirm", { name: "Grandma" }));
  expect(del).toHaveBeenCalledWith(`/phones/${PID}/extended/c1`);

  const select = m.container.querySelector<HTMLSelectElement>(`select[aria-label="${t("ext.groupFor", { name: "Grandma" })}"]`)!;
  await act(async () => {
    select.value = "family";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(patch).toHaveBeenCalledWith(`/phones/${PID}/extended/c1`, { group: "family" });
  expect(m.container.textContent).toContain(t("ext.groupHelp"));
  await m.unmount();
});

it("renders a live snapshot with a map link and copyable coordinates, and a gone one without", async () => {
  thread = inbox([
    { id: "s1", from: "child", kind: "snapshot", text: "", sentAt: "2026-11-19T15:40:00Z", delivered: 1,
      location: { lat: 55.67594, lon: 12.56553, accuracyM: 20, recordedAt: "2026-11-19T15:40:00Z", expiresAt: SNAPSHOT_END } },
    { id: "s2", from: "child", kind: "snapshot", text: "", sentAt: "2026-11-19T12:00:00Z", delivered: 1, location: null },
  ]);
  const m = await mount({ familyInbox: true });
  const [live, gone] = Array.from(m.container.querySelectorAll(".inbox-message"));
  expect(live!.textContent).toContain(t("ext.snapshot"));
  expect(live!.textContent).toContain(t("ext.snapshotUntil", { time: snapshotUntil(SNAPSHOT_END, "en") }));
  const link = live!.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://www.openstreetmap.org/?mlat=55.67594&mlon=12.56553#map=17/55.67594/12.56553");
  expect(link.getAttribute("rel")).toContain("noopener");
  await act(async () => m.button(t("ext.copyCoords")).click());
  expect(writeText).toHaveBeenCalledWith("55.67594, 12.56553");
  expect(gone!.textContent).toContain(t("ext.snapshotGone"));
  expect(gone!.querySelector("a")).toBeNull();
  await m.unmount();
});
