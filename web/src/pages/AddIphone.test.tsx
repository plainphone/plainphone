// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { SessionProvider } from "../lib/session";
import { AddIphonePage } from "./AddIphone";
import { AddPhonePage } from "./AddPhone";

const t = makeT("en");

async function render(path: string, iosPairing: boolean | undefined) {
  const me = { user: { id: "u", email: "parent@example.org", locale: "en" }, households: [], mailEnabled: true, ...(iosPairing === undefined ? {} : { iosPairing }) };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/me" ? Response.json(me) : Response.json({})));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <I18nProvider>
      <SessionProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/add" element={<AddPhonePage />} />
            <Route path="/add/iphone" element={<AddIphonePage />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </I18nProvider>,
  ));
  return { container, unmount: () => act(async () => root.unmount()) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("offers 'An iPhone' in Add phone only while the server pairs iPhones", async () => {
  const on = await render("/add", true);
  const link = [...on.container.querySelectorAll("a")].find((a) => a.textContent?.includes(t("platform.iphone.add")));
  expect(link?.getAttribute("href")).toBe("/add/iphone");
  await on.unmount();

  for (const flag of [false, undefined]) {
    const off = await render("/add", flag);
    expect(off.container.textContent).not.toContain(t("platform.iphone.add"));
    // The Android choices are unchanged.
    expect(off.container.textContent).toContain(t("add.modeStrong"));
    await off.unmount();
  }
});

it("asks whose iPhone it is and lists Apple's prerequisites for that role", async () => {
  const { container, unmount } = await render("/add/iphone", true);
  expect(container.querySelector("legend")?.textContent).toBe(t("platform.iphone.who"));
  const text = () => container.textContent ?? "";
  expect(text()).toContain(t("platform.iphone.needFamily"));
  expect(text()).toContain(t("platform.iphone.needAccount"));
  expect(text()).toContain(t("platform.iphone.needScreenTime"));
  const next = () => [...container.querySelectorAll("a")].find((a) => a.textContent === t("platform.iphone.next"))!;
  expect(next().getAttribute("href")).toBe("/pair?profile=child");

  // Myself: no child account or Family Sharing needed, and the code is claimed as a Self phone.
  await act(async () => container.querySelector<HTMLInputElement>('input[value="self"]')!.click());
  expect(text()).not.toContain(t("platform.iphone.needAccount"));
  expect(text()).not.toContain(t("platform.iphone.needFamily"));
  expect(text()).toContain(t("platform.iphone.needScreenTime"));
  expect(next().getAttribute("href")).toBe("/pair?profile=self");
  await unmount();
});

it("says 'not yet' when the iPhone page is opened on a server without iPhone pairing", async () => {
  const { container, unmount } = await render("/add/iphone", false);
  expect(container.textContent).toContain(t("platform.iphone.notYet"));
  expect(container.querySelector("legend")).toBeNull();
  await unmount();
});
