// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { ContactsPage } from "./Contacts";

const state = vi.hoisted(() => ({
  data: {
    contacts: [] as { id: string; name: string; number: string }[],
    lightContactRestriction: true,
    suggestDeviceContacts: false,
    selfScheduleContacts: false as boolean | null,
  },
  phone: { id: "phone", mode: "light", profile: "child" } as Record<string, unknown>,
}));
vi.mock("./Phone", () => ({
  usePhone: () => ({ phone: state.phone, pending: [] }),
}));
vi.mock("../components/ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("../components/ui")>(),
  useLoad: () => ({ data: state.data }),
}));

afterEach(() => vi.unstubAllGlobals());

it("warns only when the light phone restricts calls and texts and has no approved contacts", () => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  const render = () => renderToStaticMarkup(<I18nProvider><ContactsPage /></I18nProvider>);
  const warning = "Nobody can call or text this phone except emergency numbers.";

  expect(render()).toContain(warning);
  state.data.lightContactRestriction = false;
  expect(render()).not.toContain(warning);
  state.data.lightContactRestriction = true;
  state.data.contacts.push({ id: "contact", name: "Alex", number: "+4512345678" });
  expect(render()).not.toContain(warning);
});

it("shows Apple's honest line instead of Android-only contact switches on an iPhone", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  const { en } = await import("../i18n/en");
  const render = () => renderToStaticMarkup(<I18nProvider><ContactsPage /></I18nProvider>);
  const iosLine = "On iPhone, Apple controls who can call.";
  const android = { id: "phone", mode: "light", profile: "child", platform: "android" };
  const iphone = { ...android, platform: "ios", tier: "family_controls" };

  state.phone = android;
  expect(render()).toContain(en["contacts.suggestFromPhone"]);
  expect(render()).not.toContain(iosLine);
  state.phone = iphone;
  expect(render()).not.toContain(en["contacts.suggestFromPhone"]);
  expect(render()).toContain(iosLine);

  // Myself: limiting calls during schedules is Android's; an iPhone gets the same honest line.
  state.phone = { ...android, profile: "self" };
  expect(render()).toContain(en["contacts.restrictScheduled"]);
  state.phone = { ...iphone, profile: "self" };
  expect(render()).not.toContain(en["contacts.restrictScheduled"]);
  expect(render()).toContain(iosLine);
});
