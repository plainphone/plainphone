// SPDX-License-Identifier: Apache-2.0
//
// Fixture page for the status screenshots (docs/screenshots/ux-status-readable). It renders the
// real components with the synthetic fixtures from src/lib/status-fixtures.ts. Only the dev
// server serves it; `vite build` ignores it.
//   /screenshots/status.html?scene=phones|overview|approvals&variant=before|after&lang=en|da
// "before" renders what the dashboard showed before this change, with the same fixture.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalQueue } from "../src/components/ApprovalQueue";
import { PhoneStateHint, PhoneStateTitle } from "../src/components/PhoneState";
import { I18nProvider, useI18n } from "../src/i18n/I18n";
import type { Approval } from "../src/lib/api";
import type { Processed } from "@plainphone/shared/approval-state";
import { formatRelative } from "@plainphone/shared/format";
import { approvalFixtures, FIXTURE_NOW, phoneFixtures } from "@plainphone/shared/status-fixtures";
import "../src/styles.css";

const params = new URLSearchParams(window.location.search);
const scene = params.get("scene") ?? "phones";
const before = params.get("variant") === "before";
localStorage.setItem("pp.locale", params.get("lang") === "da" ? "da" : "en");

/** What the dashboard said before: the last connection and the last report in two unrelated lines. */
const OLD = {
  en: { lastSeen: "Last online {when}", never: "Hasn’t been online yet", none: "No status from the phone yet", empty: "Nothing waits for you right now.",
    approved: "Approved. Takes effect the next time the phone is online (usually within a minute).", rejected: "Rejected.",
    unavailable: "This request is unavailable. Ask for a new code.", changed: "Review the updated request before approving." },
  da: { lastSeen: "Sidst online {when}", never: "Har ikke været online endnu", none: "Ingen status fra telefonen endnu", empty: "Intet venter på dig lige nu.",
    approved: "Godkendt. Gælder, næste gang telefonen er online (normalt inden for et minut).", rejected: "Afvist.",
    unavailable: "Anmodningen er ikke tilgængelig. Bed om en ny kode.", changed: "Se den opdaterede anmodning, før du godkender." },
} as const;

function Phones() {
  const { t, locale } = useI18n();
  const old = OLD[locale];
  return (
    <>
      <div className="page-title"><h1>{t("phones.title")}</h1></div>
      <ul className="list phone-list">
        {phoneFixtures.map((p) => (
          <li key={p.id}>
            <a className="row-link" href="#phones">
              <span className="row-main">
                <span className="row-title">{p.name}</span>
                <span className="row-meta">
                  <span className="tag tag-child">{t("profile.child")}</span>
                  {before
                    ? <span>{p.lastSeenAt ? old.lastSeen.replace("{when}", formatRelative(p.lastSeenAt, FIXTURE_NOW, locale)) : old.never}</span>
                    : <PhoneStateTitle phone={p} now={FIXTURE_NOW} />}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function Overview() {
  const { t, locale } = useI18n();
  const old = OLD[locale];
  return (
    <>
      {phoneFixtures.map((p) => (
        <section key={p.id} className="section" aria-label={p.label}>
          <div className="page-title">
            <h2>{p.name}</h2>
            <p className="lede">
              <span className="row-meta">
                <span className="tag tag-child">{t("profile.child")}</span>
                {before
                  ? <span>{p.lastSeenAt ? old.lastSeen.replace("{when}", formatRelative(p.lastSeenAt, FIXTURE_NOW, locale)) : old.never}</span>
                  : <PhoneStateTitle phone={p} now={FIXTURE_NOW} />}
              </span>
            </p>
          </div>
          {before
            ? (p.status ? null : <p className="muted">{old.none}</p>)
            : <PhoneStateHint phone={p} now={FIXTURE_NOW} />}
        </section>
      ))}
    </>
  );
}

const asApproval = (f: (typeof approvalFixtures)[number]): Approval => ({
  id: f.id, phoneId: f.phoneName, phoneName: f.phoneName, requestedBy: null, summary: f.summary, revision: "0".repeat(64), createdAt: "2026-11-19T08:00:00Z",
});

function Approvals() {
  const { t, locale } = useI18n();
  const old = OLD[locale];
  const open = approvalFixtures.filter((f) => !f.processed).map(asApproval);
  const done: Processed<Approval>[] = approvalFixtures.flatMap((f) => (f.processed ? [{ approval: asApproval(f), ...f.processed }] : []));
  // Before: an answered request vanished and a banner said something once. These are the banners.
  const banners = { approvalApproved: old.approved, declined: old.rejected, expired: old.unavailable, conflict: old.changed };
  return (
    <>
      <div className="page-title"><h1>{t("appr.title")}</h1><p className="lede">{t("appr.intro")}</p></div>
      {before
        ? (
          <div className="stack">
            <ul className="list item-list">
              {open.map((a) => (
                <li key={a.id} className="item item-stack">
                  <div>
                    <p className="row-title">{a.summary[locale]}</p>
                    <p className="row-meta">{a.phoneName}</p>
                  </div>
                  <div className="actions">
                    <button type="button" className="btn btn-primary">{t("appr.approve")}</button>
                    <button type="button" className="btn btn-secondary">{t("appr.reject")}</button>
                  </div>
                </li>
              ))}
            </ul>
            {Object.entries(banners).map(([k, text]) => <div key={k} className="notice notice-info"><p>{text}</p></div>)}
          </div>
        )
        : <ApprovalQueue open={open} done={done} showOwner busy={null} approveOnly={false} focusId={null} onDecide={() => {}} />}
    </>
  );
}

const scenes = { phones: Phones, overview: Overview, approvals: Approvals } as const;
const Scene = scenes[scene as keyof typeof scenes] ?? Phones;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <main><Scene /></main>
    </I18nProvider>
  </StrictMode>,
);
