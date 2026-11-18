// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { ApprovalsPage } from "./Approvals";

vi.mock("../components/ApprovalScanner", () => ({ ApprovalScanner: () => null }));
vi.mock("../components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/ui")>();
  const approvals = [30, 60].map((minutes) => ({
    id: String(minutes),
    phoneId: "phone",
    phoneName: "Phone",
    requestedBy: null,
    summary: { en: `Instagram: 15 → ${minutes} min a day`, da: `Instagram: 15 → ${minutes} min om dagen` },
    createdAt: "2026-11-18T10:00:00Z",
  }));
  const reload = vi.fn();
  return {
    ...actual,
    useLoad: vi.fn()
      .mockReturnValueOnce({ data: approvals, loading: false, reload })
      .mockReturnValueOnce({ data: { people: [] }, loading: false, reload })
      .mockReturnValueOnce({ data: approvals, loading: false, reload })
      .mockReturnValueOnce({ data: { people: [] }, loading: false, reload }),
  };
});

afterEach(() => vi.unstubAllGlobals());

it("shows the requested amounts in the helper list and the one change selected by a QR", () => {
  const render = (hash: string) => {
    vi.stubGlobal("window", { location: { hash } });
    vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
    return renderToStaticMarkup(<I18nProvider><ApprovalsPage /></I18nProvider>);
  };

  const list = render("");
  expect(list).toContain("Approve: Instagram: 15 → 30 min a day");
  expect(list).toContain("Approve: Instagram: 15 → 60 min a day");

  const scanned = render("#code=phone.60.expiry.nonce");
  expect(scanned).toContain("Approve: Instagram: 15 → 60 min a day");
  expect(scanned).not.toContain("Instagram: 15 → 30 min a day");
});
