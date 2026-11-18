// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { ContactsPage } from "./Contacts";

const state = vi.hoisted(() => ({
  data: { contacts: [] as { id: string; name: string; number: string }[], lightContactRestriction: true, suggestDeviceContacts: false },
}));
vi.mock("./Phone", () => ({
  usePhone: () => ({ phone: { id: "phone", mode: "light", profile: "child" }, pending: [] }),
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
