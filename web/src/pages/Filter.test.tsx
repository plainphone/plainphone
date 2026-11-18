// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "../i18n/translate";
import { FilterPage } from "./Filter";

const { host } = vi.hoisted(() => ({ host: "phone.dns.example.test" }));

vi.mock("./Phone", () => ({
  usePhone: () => ({ phone: { id: "phone", dnsReady: false, dnsConfigured: true }, pending: [] }),
}));

vi.mock("../components/ui", async (importOriginal) => ({
  ...await importOriginal<typeof import("../components/ui")>(),
  useLoad: () => ({
    data: { host, synced: false, blockedCategories: [], allowDomains: [], blockDomains: [] },
  }),
}));

it("shows a newly confirmed DNS address and its sync status despite a stale phone summary", () => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
  try {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <MemoryRouter initialEntries={["/phones/phone/filter"]}>
          <Routes>
            <Route path="/phones/:pid/filter" element={<FilterPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    const t = makeT("en");
    expect(html).toContain(host);
    expect(html).toContain(t("filter.notSynced"));
    expect(html).not.toContain(t("filter.waitingDns"));
  } finally {
    vi.unstubAllGlobals();
  }
});
