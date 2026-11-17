// SPDX-License-Identifier: Apache-2.0
import { useEffect, useLayoutEffect, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { lightSetupIntent } from "../lib/light-setup";
import { PageTitle } from "../components/ui";
import "./add-phone.css";

export function InstallPhonePage() {
  const { t, setLocale } = useI18n();
  const [url] = useState(() => new URL(window.location.href));
  useLayoutEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
  }, [url]);
  useEffect(() => {
    const lang = new URLSearchParams(url.hash.slice(1)).get("lang");
    if (lang === "da" || lang === "en") setLocale(lang);
  }, [setLocale, url]);
  const intent = lightSetupIntent(url);
  if (!intent) return <PageTitle sub={t("add.invalidLink")}>{t("add.installTitle")}</PageTitle>;
  return (
    <div className="narrow stack">
      <PageTitle sub={t("add.installIntro")}>{t("add.installTitle")}</PageTitle>
      <ol className="setup-steps">
        <li>
          <div className="stack">
            <p>{t("add.downloadStep")}</p>
            <div><a className="btn btn-primary" href="/download/android">{t("add.download")}</a></div>
          </div>
        </li>
        <li>
          <div className="stack">
            <p>{t("add.openStep")}</p>
            <div><a className="btn btn-secondary" href={intent}>{t("add.openApp")}</a></div>
          </div>
        </li>
      </ol>
      <details>
        <summary>{t("add.installHelp")}</summary>
        <p>{t("add.installHelpBody")}</p>
      </details>
    </div>
  );
}
