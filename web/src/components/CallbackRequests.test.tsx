// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { CallbackRequests } from "./CallbackRequests";
import { CallbackSettings } from "./CallbackSettings";

// Synthetic numbers only.
const NUMBER = "+4500000001";
const request = {
  id: "r1", state: "sent", createdAt: "2026-11-19T14:32:00Z", expiresAt: "2026-11-20T14:32:00Z",
  doneAt: null, doneVia: null, number: "ok",
};
const state = vi.hoisted(() => ({ response: {} as unknown }));
vi.mock("./ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ui")>()),
  useLoad: () => ({ data: state.response, reload: () => Promise.resolve(), setData: () => undefined }),
}));

afterEach(() => vi.unstubAllGlobals());

function render(node: React.ReactNode) {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  return renderToStaticMarkup(<StaticRouter location="/"><I18nProvider>{node}</I18nProvider></StaticRouter>);
}

it("shows the saved number before the call button and offers calling from the parent's own contacts", () => {
  state.response = { callbackNumber: NUMBER, requests: [request] };
  const html = render(<CallbackRequests pid="phone" />);
  expect(html).toContain(`Number saved for this phone: ${NUMBER}`);
  expect(html).toContain(`Call ${NUMBER}`);
  expect(html.indexOf("Number saved")).toBeLessThan(html.indexOf("Call +"));
  expect(html).toContain("I will call from my own contacts");
  // Nothing dials by itself: no tel: link, only a button.
  expect(html).not.toContain("tel:");
});

it("says a changed number changed and links to the settings instead of offering to dial", () => {
  state.response = { callbackNumber: "+4500000002", requests: [{ ...request, number: "changed" }] };
  const html = render(<CallbackRequests pid="phone" />);
  expect(html).toContain("The number was changed after this request");
  expect(html).toContain('href="#callback-settings"');
  expect(html).not.toContain("+4500000002");
  expect(html).not.toContain("Call +");
  expect(html).toContain("I will call from my own contacts");
});

it("says a cleared number is missing", () => {
  state.response = { callbackNumber: null, requests: [{ ...request, number: "missing" }] };
  const html = render(<CallbackRequests pid="phone" />);
  expect(html).toContain("No number is saved for this phone any more");
  expect(html).not.toContain("Call +");
});

it("shows queued, sent and expired as different things", () => {
  state.response = {
    callbackNumber: NUMBER,
    requests: [{ ...request, id: "a", state: "queued" }, { ...request, id: "b", state: "sent" }, { ...request, id: "c", state: "expired" }],
  };
  const html = render(<CallbackRequests pid="phone" />);
  expect(html).toContain("No parent device has been notified yet");
  expect(html).toContain("Parents have been notified.");
  expect(html).toContain("Expired. Nobody answered within 24 hours.");
  // An expired request cannot be dialled.
  expect(html.match(/Call \+/g)).toHaveLength(2);
});

it("shows only open requests on the overview, with the phone's name", () => {
  state.response = { callbackNumber: NUMBER, requests: [{ ...request, state: "expired" }] };
  expect(render(<CallbackRequests pid="phone" phoneName="Sam" />)).toBe("");
  state.response = { callbackNumber: NUMBER, requests: [request] };
  expect(render(<CallbackRequests pid="phone" phoneName="Sam" />)).toContain("Sam asks you to call");
});

it("keeps the switch off until a number is confirmed", () => {
  const props = { enabled: false, saving: false, error: false, onSave: async () => undefined, onSwitch: () => undefined };
  const unconfirmed = render(<CallbackSettings {...props} number={null} confirmed={false} />);
  expect(unconfirmed).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*disabled/);
  expect(unconfirmed).toContain("Enter the number and confirm it to turn this on.");
  expect(render(<CallbackSettings {...props} number={NUMBER} confirmed={false} />)).toContain("This number is not confirmed yet");
  const confirmed = render(<CallbackSettings {...props} number={NUMBER} confirmed />);
  expect(confirmed).not.toMatch(/role="switch"[^>]*disabled/);
  expect(confirmed).toContain("Let this phone ask a parent to call back.");
});
