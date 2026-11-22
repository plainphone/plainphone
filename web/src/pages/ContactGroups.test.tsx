// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { api } from "../lib/api";
import { ContactsPage } from "./Contacts";

const t = makeT("en");
vi.mock("./Phone", () => ({
  usePhone: () => ({ phone: { id: "p1", profile: "child", mode: "strong" }, pending: [], run: vi.fn(), refreshRuleReceipt: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["en"] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("moves a contact to another group and keeps a parent fixed in Family", async () => {
  vi.spyOn(api, "get").mockResolvedValue({
    suggestDeviceContacts: false,
    contacts: [
      { id: "c1", name: "Grandma", number: "+4511111111", group: "others" },
      { id: "c2", name: "Mum", number: "+4522222222", group: "family", sosParent: true },
    ],
  });
  const patch = vi.spyOn(api, "patch").mockResolvedValue({});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<I18nProvider><ContactsPage /></I18nProvider>));

  expect(container.textContent).toContain(t("group.help"));
  expect(container.textContent).toContain(t("group.parentFixed"));
  const selects = container.querySelectorAll("select");
  expect(selects).toHaveLength(1);
  expect(selects[0]!.getAttribute("aria-label")).toBe(`${t("group.label")}: Grandma`);
  expect(selects[0]!.value).toBe("others");

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(selects[0], "friends");
    selects[0]!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(patch).toHaveBeenCalledWith("/phones/p1/contacts/c1", { group: "friends" });
  expect((container.querySelector("select") as HTMLSelectElement).value).toBe("friends");
  await act(async () => root.unmount());
  container.remove();
});
