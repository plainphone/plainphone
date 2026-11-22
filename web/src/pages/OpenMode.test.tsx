// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { makeT } from "@plainphone/i18n/translate";
import type { OpenModeState } from "../lib/api";
import { describeOp } from "@plainphone/shared/ops";
import { OpenModePanel } from "./OpenMode";

const { loaded } = vi.hoisted(() => ({ loaded: { data: undefined as unknown as OpenModeState } }));

vi.mock("./Phone", () => ({
  usePhone: () => ({
    phone: { id: "phone", profile: "self", openMode: loaded.data.enabled },
    setPhone: () => undefined,
    pending: [],
    run: (action: () => Promise<unknown>) => action(),
  }),
}));

vi.mock("../components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/ui")>()),
  useLoad: () => ({ data: loaded.data, setData: () => undefined, reload: () => undefined }),
}));

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => "en" });
  vi.stubGlobal("navigator", { languages: ["en"] });
});
afterEach(() => vi.unstubAllGlobals());

const categories = (blocked: boolean[]): OpenModeState["categories"] => [
  { category: "social", blocked: blocked[0]!, hasApps: true },
  { category: "gambling", blocked: blocked[1]!, hasApps: true },
  { category: "adult", blocked: blocked[2]!, hasApps: false },
];

const render = () => renderToStaticMarkup(<I18nProvider><OpenModePanel onChanged={() => undefined} /></I18nProvider>);

it("summarises what is blocked and shows a switch per category when open", () => {
  loaded.data = { enabled: true, categories: categories([true, false, true]), blockedApps: [{ packageName: "com.example.notes", label: "Notes" }] };
  const html = render();
  const t = makeT("en");
  expect(html).toContain("Open: everything is allowed except social media, adult content and Notes.");
  expect(html).toContain(t("open.toggleHelp"));
  for (const c of ["social", "gambling", "adult"] as const) expect(html).toContain(t(`open.cat.${c}`));
  expect(html).toContain(t("open.looseningHelp"));
});

it("says so when nothing is blocked", () => {
  loaded.data = { enabled: true, categories: categories([false, false, false]), blockedApps: [] };
  expect(render()).toContain(makeT("en")("open.summaryNone"));
});

it("hides the categories and says the phone is closed when open mode is off", () => {
  loaded.data = { enabled: false, categories: categories([true, true, true]), blockedApps: [] };
  const html = render();
  const t = makeT("en");
  expect(html).toContain(t("open.summaryOff"));
  expect(html).not.toContain(t("open.categoriesHelp"));
});

it("describes open mode changes in both languages", () => {
  expect(describeOp({ type: "openMode.set", enabled: true }, makeT("da"), "da")).toBe("Åben tilstand: tillad alle apps undtagen blokeringslisten");
  expect(describeOp({ type: "openMode.category", category: "social", blocked: false }, makeT("en"), "en")).toBe("Allow social media (apps and websites)");
  expect(describeOp({ type: "openMode.category", category: "gambling", blocked: true }, makeT("da"), "da")).toBe("Bloker spil om penge (apps og hjemmesider)");
});
