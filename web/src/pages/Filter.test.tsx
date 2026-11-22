// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import { api, type Phone, type PhoneStatus } from "../lib/api";
import { PhoneStatusBlock } from "./Phone";
import { FilterPage } from "./Filter";

const { host, state, methodChanged, reload } = vi.hoisted(() => ({
  host: "phone.dns.example.test",
  state: { configured: true, method: "privateDns" as "vpn" | "privateDns", host: "phone.dns.example.test" as string | null, rulesReady: undefined as boolean | undefined },
  methodChanged: vi.fn<(checked: boolean) => void>(),
  reload: vi.fn(),
}));

vi.mock("./Phone", async (importOriginal) => ({
  ...await importOriginal<typeof import("./Phone")>(),
  usePhone: () => ({
    phone: { id: "phone", mode: "light", dnsReady: false, dnsConfigured: state.configured },
    pending: [],
    run: (action: () => Promise<unknown>) => action(),
  }),
}));

vi.mock("../components/ui", async (importOriginal) => {
  const ui = await importOriginal<typeof import("../components/ui")>();
  return {
    ...ui,
    Switch: (props: Parameters<typeof ui.Switch>[0]) => {
      if (props.label === "Private DNS") methodChanged.mockImplementation(props.onChange);
      return <ui.Switch {...props} />;
    },
    useLoad: () => ({
      data: { host: state.host, rulesReady: state.rulesReady, filterMethod: state.method, synced: false, blockedCategories: [], allowDomains: [], blockDomains: [] },
      reload,
    }),
  };
});

beforeEach(() => {
  state.method = "privateDns";
  state.host = host;
  state.rulesReady = undefined;
  state.configured = true;
  methodChanged.mockReset();
  reload.mockClear();
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderFilter() {
  return renderToStaticMarkup(
    <I18nProvider>
      <MemoryRouter initialEntries={["/phones/phone/filter"]}>
        <Routes>
          <Route path="/phones/:pid/filter" element={<FilterPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

it("shows a newly confirmed DNS address and its sync status despite a stale phone summary", () => {
  const html = renderFilter();
  const t = makeT("en");
  expect(html).toContain(host);
  expect(html).toContain(t("filter.privateDns"));
  expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
  expect(html).toContain(t("filter.notSynced"));
  expect(html).not.toContain(t("filter.waitingDns"));
});

it.each([
  ["a phone the resolver has not confirmed yet", null, false, true],
  ["a phone that is filtered but whose address is not tagged yet", null, true, false],
  ["a phone with a confirmed address", host, true, false],
] as const)("says the filter is being set up only for %s", (_name, dnsHost, rulesReady, waiting) => {
  state.host = dnsHost;
  state.rulesReady = rulesReady;
  const html = renderFilter();
  expect(html.includes(makeT("en")("filter.waitingDns"))).toBe(waiting);
  expect(html.includes(host)).toBe(dnsHost !== null);
});

it.each([
  ["vpn", true, "privateDns"],
  ["privateDns", false, "vpn"],
] as const)("sends the new filter method when switching away from %s", async (current, checked, next) => {
  state.method = current;
  const put = vi.spyOn(api, "put").mockResolvedValue({ status: "applied" });
  renderFilter();
  methodChanged(checked);
  expect(put).toHaveBeenCalledExactlyOnceWith("/phones/phone/dns/method", { method: next });
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

const phone: Phone = {
  id: "phone", name: "My phone", mode: "light", profile: "self", timezone: "Europe/Copenhagen",
  pairedAt: null, releaseRequestedAt: null, lastSeenAt: null, dnsHost: host, dnsReady: true,
  dnsSynced: true, locationEnabled: false, hasLocation: false, status: null, openRequests: 0,
  offlineAlertHours: null, offlineAlertHoursDefault: 12,
};

it.each([
  ["privateDns", "off", "filter.privateOff"],
  ["privateDns", "automatic", "filter.privateAutomatic"],
  ["privateDns", "wrongHost", "filter.privateWrongHost"],
  ["privateDns", "waiting", "filter.privateWaiting"],
  ["privateDns", "unverified", "filter.privateUnverified"],
  ["privateDns", "alwaysOn", "filter.privateAlwaysOn"],
  ["vpn", "strictDns", "filter.vpnStrictDns"],
] as const)("shows %s recovery instructions for %s on the phone overview", (filterMethod, filterIssue, key) => {
  const status: PhoneStatus = {
    filterMethod, filterIssue, filterWorking: false, lockIntact: false, maintenance: false,
    failedPolicies: [], appVersion: "0.1.0", batteryPct: null, charging: null, deviceOwner: false,
    rulesEtag: null, rulesAppliedAt: null, dnsHost: null, reportedAt: "2026-11-19T12:00:00Z",
  };
  const html = renderToStaticMarkup(
    <I18nProvider>
      <MemoryRouter>
        <PhoneStatusBlock phone={{ ...phone, lastSeenAt: status.reportedAt, status }} now={Date.parse(status.reportedAt)} />
      </MemoryRouter>
    </I18nProvider>,
  );
  // The health card shows the filter row; only waiting and unverified are inconclusive, not an action.
  const inconclusive = filterIssue === "waiting" || filterIssue === "unverified";
  expect(html).toContain(`<div${inconclusive ? "" : ' class="health-action"'}><dt>Web filter</dt><dd>${makeT("en")(key)}</dd></div>`);
});

it("shows the Private DNS repair notice when the health card is off", () => {
  const status: PhoneStatus = {
    filterMethod: "privateDns", filterIssue: "unverified", filterWorking: false, lockIntact: false, maintenance: false,
    failedPolicies: [], appVersion: "0.1.0", batteryPct: null, charging: null, deviceOwner: false,
    rulesEtag: null, rulesAppliedAt: null, dnsHost: null, reportedAt: "2026-11-19T12:00:00Z",
  };
  const html = renderToStaticMarkup(
    <I18nProvider>
      <MemoryRouter>
        <PhoneStatusBlock phone={{ ...phone, healthBoardEnabled: false, lastSeenAt: status.reportedAt, status }} now={Date.parse(status.reportedAt)} />
      </MemoryRouter>
    </I18nProvider>,
  );
  expect(html).toContain(makeT("en")("filter.privateUnverified"));
  expect(html).not.toContain("<dt>Web filter</dt>");
});

it("says the server has no web filter service even when the phone counts as ready", () => {
  state.configured = false;
  state.rulesReady = true;
  const html = renderFilter();
  expect(html).toContain(makeT("en")("filter.noDnsService"));
});
