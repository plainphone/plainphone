// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import type { Approval } from "../lib/api";
import type { Processed } from "../lib/approval-state";
import { approvalFixtures } from "../lib/status-fixtures";
import { ApprovalQueue } from "./ApprovalQueue";

afterEach(() => vi.unstubAllGlobals());

const approval = (f: (typeof approvalFixtures)[number]): Approval => ({
  id: f.id, phoneId: f.phoneName, phoneName: f.phoneName, requestedBy: null, summary: f.summary, revision: "0".repeat(64), createdAt: "2026-11-19T08:00:00Z",
});

function render(lang: "en" | "da", busy: string | null = null) {
  vi.stubGlobal("navigator", { language: lang, languages: [lang] });
  const open = approvalFixtures.filter((f) => !f.processed).map(approval);
  const done: Processed<Approval>[] = approvalFixtures.flatMap((f) => (f.processed ? [{ approval: approval(f), ...f.processed }] : []));
  return renderToStaticMarkup(
    <I18nProvider>
      <ApprovalQueue open={open} done={done} showOwner busy={busy} approveOnly={false} focusId={null} onDecide={() => {}} />
    </I18nProvider>,
  );
}

it("shows what is still waiting and the result of every answered request in place", () => {
  const html = render("en");
  expect(html).toContain("1 request waits for you");
  expect(html).toContain("Approved. Takes effect the next time the phone is online (usually within a minute).");
  expect(html).toContain("Declined. The phone keeps its current rule.");
  expect(html).toContain("This code has expired. Ask the phone for a new one.");
  expect(html).toContain("You already declined this request, so it stays declined.");
  // Open requests keep both answers; answered ones have none, so they cannot be answered twice.
  expect(html.match(/>Approve</g)).toHaveLength(1);
  expect(html.match(/>Reject</g)).toHaveLength(1);
});

it("has no live region of its own: the page announces each result once", () => {
  const html = render("en");
  expect(html).not.toContain("aria-live");
  expect(html).not.toContain('role="status"');
  expect(html).not.toContain('role="alert"');
});

it("turns the buttons off while an answer is on its way, in Danish too", () => {
  const html = render("da", "a1");
  expect(html).toContain("1 anmodning venter på dig");
  expect(html).toContain("Godkendt. Gælder, næste gang telefonen er online (normalt inden for et minut).");
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});
