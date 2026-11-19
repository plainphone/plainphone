// SPDX-License-Identifier: Apache-2.0
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useI18n } from "../i18n/I18n";
import { api, type Approval } from "../lib/api";
import { clearNextIf, useSession } from "../lib/session";
import { isLanguage, languageNames, languages } from "../lib/phone-language";
import { Mark } from "./Mark";

/** The privacy policy lives on the website, in the language of the app. */
const privacyUrl = (locale: string) => `https://plainphone.org${locale === "en" ? "" : `/${locale}`}/privacy/`;

export function Shell() {
  const { t, locale } = useI18n();
  const { state, logout, saveLocale } = useSession();
  const loc = useLocation();
  const navigate = useNavigate();
  const signedIn = state.status === "in";
  const main = useRef<HTMLElement>(null);
  const [approvals, setApprovals] = useState(0);

  // The Approvals page only shows up for someone who is a trusted person with something waiting.
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api
      .get<{ approvals: Approval[] }>("/approvals")
      .then((r) => alive && setApprovals(r.approvals.length))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [signedIn, loc.pathname]);

  useEffect(() => {
    if (signedIn) clearNextIf(loc.pathname + loc.search + loc.hash);
  }, [signedIn, loc.pathname, loc.search, loc.hash]);

  const phonesActive = loc.pathname === "/" || loc.pathname.startsWith("/phones") || loc.pathname === "/pair";

  return (
    <>
      <a className="skip" href="#main" onClick={(event) => {
        event.preventDefault();
        main.current?.focus();
      }}>
        {t("app.skip")}
      </a>
      <header className="site-header">
        <div className="wrap header-row">
          <Link to="/" className="brand">
            <Mark />
            <span>{t("app.name")}</span>
          </Link>
          <div className="header-tools">
            <select className="lang-switch" aria-label={t("nav.language")} value={locale} onChange={(event) => {
              const language = event.target.value;
              if (isLanguage(language)) saveLocale(language);
            }}>
              {languages.map((language) => <option key={language} value={language} lang={language}>{languageNames[language]}</option>)}
            </select>
            {signedIn && (
              <button
                type="button"
                className="btn-link"
                onClick={() => void logout().then(() => navigate("/login"))}
              >
                {t("nav.logout")}
              </button>
            )}
          </div>
        </div>
        {signedIn && (
          <nav className="wrap main-nav" aria-label={t("nav.label")}>
            <ul>
              <NavItem to="/" active={phonesActive}>
                {t("nav.phones")}
              </NavItem>
              <NavItem to="/household" active={loc.pathname === "/household"}>
                {t("nav.household")}
              </NavItem>
              <NavItem to="/settings" active={loc.pathname === "/settings"}>
                {t("nav.settings")}
              </NavItem>
              {(approvals > 0 || loc.pathname === "/approvals") && (
                <NavItem to="/approvals" active={loc.pathname === "/approvals"}>
                  {t("nav.approvals")}
                  {approvals > 0 && <span className="count">{approvals}</span>}
                </NavItem>
              )}
            </ul>
          </nav>
        )}
      </header>
      <main id="main" className="wrap" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="wrap site-footer">
        <a href={privacyUrl(locale)} target="_blank" rel="noopener noreferrer">
          {t("nav.privacy")}
        </a>
      </footer>
    </>
  );
}

function NavItem({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <li>
      <Link to={to} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
        {children}
      </Link>
    </li>
  );
}
