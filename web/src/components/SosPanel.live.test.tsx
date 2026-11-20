// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { SosPanel } from "./SosPanel";

const state = vi.hoisted(() => ({ response: undefined as unknown }));
vi.mock("./ui", () => ({
  useLoad: () => ({ data: state.response, error: null, reload: () => Promise.resolve(), setData: () => undefined }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("announces a new alert on the phones list through a live region that was already there", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("pp.locale", "en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => root.render(<I18nProvider><MemoryRouter><SosPanel pid="phone" phoneName="Alma" /></MemoryRouter></I18nProvider>);

  state.response = { events: [], callbackNumber: null };
  await act(async () => render());
  // Screen readers only read changes to a live region that exists before the change.
  const live = container.querySelector("[aria-live=assertive]");
  expect(live).not.toBeNull();
  expect(live?.textContent).toBe("");

  state.response = {
    events: [{ id: "event", kind: "urgent", createdAt: "2026-11-19T14:32:00Z", seenAt: null, location: null }],
    callbackNumber: null,
  };
  await act(async () => render());
  expect(container.querySelector("[aria-live=assertive]")).toBe(live);
  expect(live?.textContent).toBe("Alma: Urgent SOS.");
  expect(container.querySelector(".sos-alert")).not.toBeNull();

  act(() => root.unmount());
  container.remove();
});
