// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { acknowledgeSos } from "../lib/api";
import { SosPanel } from "./SosPanel";

const report = { id: "event", kind: "urgent", createdAt: "2026-11-19T14:32:00Z", seenAt: null, location: { lat: 55.6, lon: 12.5 } };
const state = vi.hoisted(() => ({ response: {} as unknown }));
vi.mock("./ui", () => ({
  useLoad: () => ({ data: state.response, reload: () => Promise.resolve(), setData: () => undefined }),
}));

afterEach(() => vi.unstubAllGlobals());

it("shows the urgent banner with map, callback and acknowledgment", () => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  state.response = { events: [report], callbackNumber: "+4512345678" };
  const html = renderToStaticMarkup(<I18nProvider><SosPanel pid="phone" /></I18nProvider>);
  expect(html).toContain("sos-alert");
  expect(html).toContain("Urgent SOS");
  expect(html).toContain("tel:+4512345678");
  expect(html).toContain("https://maps.google.com/?q=55.6,12.5");
  expect(html).toContain("I’ve seen it");
});

it("says how a hidden SOS was sent, and nothing for the SOS screen", () => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  state.response = {
    events: [
      { ...report, id: "a", trigger: "power" },
      { ...report, id: "b", trigger: "clock" },
      { ...report, id: "c", trigger: "code", message: "Pizza tonight?" },
      { ...report, id: "d", trigger: null, message: null },
    ],
    callbackNumber: null,
  };
  const html = renderToStaticMarkup(<I18nProvider><SosPanel pid="phone" /></I18nProvider>);
  expect(html).toContain('data-trigger="power">Power button<');
  expect(html).toContain('data-trigger="clock">Clock<');
  expect(html).toContain("Code word «Pizza tonight?»");
  expect(html.match(/data-trigger/g)).toHaveLength(3);
});

it("warns that an alert did not reach every parent", () => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  state.response = { events: [{ ...report, deliveryFailedAt: "2026-11-19T20:32:00Z" }], callbackNumber: null };
  const html = renderToStaticMarkup(<I18nProvider><SosPanel pid="phone" /></I18nProvider>);
  expect(html).toContain("could not be delivered to every parent");
});

it("acknowledges the correct event and sends the optional label", async () => {
  const reply = { ...report, seenAt: "2026-11-19T14:33:00Z", seenByName: "Mum" };
  const send = vi.fn(async () => Response.json(reply));
  vi.stubGlobal("fetch", send);
  expect(await acknowledgeSos("phone", report.id, " Mum ")).toEqual(reply);
  expect(send).toHaveBeenCalledWith("/api/phones/phone/sos/event/seen", expect.objectContaining({
    method: "POST", body: JSON.stringify({ name: "Mum" }),
  }));
});
