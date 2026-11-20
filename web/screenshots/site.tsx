// SPDX-License-Identifier: Apache-2.0
//
// Fixture page for the dashboard pictures on plainphone.org (site/tools/site-screenshots.mjs).
// It renders the real dashboard components with a fictional family: one child phone called
// "Sam's phone", fixed dates, no network. Only the dev server serves it; `vite build` ignores it.
//   /screenshots/site.html?scene=switches|requests&lang=en|da|sv|nb|de
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Mark } from "../src/components/Mark";
import { MoreTimeRequests } from "../src/components/MoreTimeRequests";
import { PhoneStateTitle } from "../src/components/PhoneState";
import { PageTitle, Switch } from "../src/components/ui";
import { I18nProvider, useI18n } from "../src/i18n/I18n";
import { req } from "../src/lib/more-time-fixtures";
import { isLanguage } from "../src/lib/phone-language";
import { FIXTURE_NOW } from "../src/lib/status-fixtures";
import "../src/styles.css";

const params = new URLSearchParams(window.location.search);
const scene = params.get("scene") ?? "switches";
const lang = params.get("lang") ?? "en";
localStorage.setItem("pp.locale", isLanguage(lang) ? lang : "en");

/** Sam is fictional. The name of the phone is a possessive, which each language writes its own way. */
const PHONE_NAME: Record<string, string> = {
  en: "Sam’s phone",
  da: "Sams telefon",
  sv: "Sams telefon",
  nb: "Sams telefon",
  de: "Sams Handy",
};
const phoneName = PHONE_NAME[lang] ?? PHONE_NAME.en;

const phone = {
  lastSeenAt: new Date(FIXTURE_NOW - 2 * 60_000).toISOString(),
  status: { rulesAppliedAt: new Date(FIXTURE_NOW - 20 * 60_000).toISOString() },
  rulesCurrent: true,
  offlineAlertHours: null,
  offlineAlertHoursDefault: 24,
};

const noop = () => {};

function Header() {
  const { t } = useI18n();
  return (
    <header className="site-header">
      <div className="wrap header-row">
        <span className="brand"><Mark /><span>{t("app.name")}</span></span>
      </div>
    </header>
  );
}

function Switches() {
  const { t } = useI18n();
  return (
    <>
      <PageTitle sub={<PhoneStateTitle phone={phone} now={FIXTURE_NOW} />}>{phoneName}</PageTitle>
      <section className="section form-card stack" aria-label={t("sched.title")}>
        <Switch label={t("sched.title")} description={`${t("sched.weekdays")} · ${t("sched.time", { start: "08:00", end: "14:00" })}`} checked onChange={noop} />
        <Switch label={t("filter.title")} checked onChange={noop} />
        <Switch label={t("time.askSwitch")} description={t("time.askHelp")} checked onChange={noop} />
        <Switch label={t("loc.title")} description={t("loc.offTitle")} checked={false} onChange={noop} />
        <Switch label={t("summary.phoneToggle")} description={t("summary.phoneHelp")} checked={false} onChange={noop} />
      </section>
    </>
  );
}

function Requests() {
  return (
    <>
      <PageTitle sub={<PhoneStateTitle phone={phone} now={FIXTURE_NOW} />}>{phoneName}</PageTitle>
      <MoreTimeRequests phoneName={phoneName} requests={[req({ appLabel: "Maps" })]} busy={null} alreadyAnswered={new Set()} onAnswer={noop} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <div id="shot">
        <Header />
        <main className="wrap">{scene === "requests" ? <Requests /> : <Switches />}</main>
      </div>
    </I18nProvider>
  </StrictMode>,
);
