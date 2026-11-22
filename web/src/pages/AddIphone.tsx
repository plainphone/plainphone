// SPDX-License-Identifier: Apache-2.0
//
// /add/iphone: the iPhone path of "Add phone" (docs/ios/architecture.md, phase 1). Shown only
// while the server pairs iPhones. The iPhone asks the same question, "Whose phone is this?", and
// then shows a code and a QR code; the parent types the code here or scans the QR code.
import { useState } from "react";
import { Link } from "react-router";
import { PageTitle } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { Profile } from "../lib/api";
import { APPLE_SCREEN_TIME_HELP } from "@plainphone/shared/platform";
import { useIosPairing } from "../lib/session";

export function AddIphonePage() {
  const { t } = useI18n();
  const iosPairing = useIosPairing();
  const [profile, setProfile] = useState<Profile>("child");
  const back = <p className="back"><Link to="/add">{t("nav.phones")}</Link></p>;
  if (!iosPairing) {
    return <div className="narrow">{back}<p className="notice notice-info">{t("platform.iphone.notYet")}</p></div>;
  }
  return (
    <div className="narrow">
      {back}
      <PageTitle>{t("platform.iphone.addTitle")}</PageTitle>
      <div className="stack">
        <fieldset className="choices">
          <legend>{t("platform.iphone.who")}</legend>
          {(["child", "self"] as const).map((p) => (
            <label key={p} className="choice">
              <input type="radio" name="profile" value={p} checked={profile === p} onChange={() => setProfile(p)} />
              <span>
                <span className="choice-title">{t(p === "child" ? "profile.child" : "profile.self")}</span>
                <span className="choice-desc">{t(p === "child" ? "profile.childHelp" : "profile.selfHelp")}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <section className="section" aria-labelledby="iphone-needs">
          <h2 id="iphone-needs">{t("platform.iphone.needs")}</h2>
          <ul className="iphone-needs">
            {profile === "child" && <li>{t("platform.iphone.needFamily")}</li>}
            {profile === "child" && <li>{t("platform.iphone.needAccount")}</li>}
            <li>{t("platform.iphone.needScreenTime")}</li>
          </ul>
          <p><a href={APPLE_SCREEN_TIME_HELP} target="_blank" rel="noreferrer">{t("platform.iphone.needHelp")}</a></p>
        </section>
        <p>{t("platform.iphone.steps")}</p>
        <p className="help">{t("platform.iphone.scan")}</p>
        <div>
          <Link className="btn btn-primary" to={`/pair?profile=${profile}`}>{t("platform.iphone.next")}</Link>
        </div>
      </div>
    </div>
  );
}
