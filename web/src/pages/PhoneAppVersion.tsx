// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { errorMessage, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey, T } from "../i18n/translate";
import { api, type PhoneStatus } from "../lib/api";
import { updateBatteryExemptionMessage } from "../lib/failedPolicies";
import { fetchLatestPhoneVersion, hasPhoneSigningKeyChange, type LatestVersion } from "../lib/phoneUpdate";

const errorMessages: Readonly<Record<string, MessageKey>> = {
  network: "phone.updateNetwork",
  signature_mismatch: "phone.updateSignatureMismatch",
  version_not_newer: "phone.updateVersionNotNewer",
  metadata_mismatch: "phone.updateMetadataMismatch",
  install_failed: "phone.updateInstallFailed",
  unknown: "phone.updateFailed",
};

function updateMessage(status: PhoneStatus, latest: LatestVersion | undefined, t: T) {
  const update = status.update;
  if (update?.state === "failed" || update?.state === "refused") {
    const code = update.errorCode;
    return t(code && Object.hasOwn(errorMessages, code) ? errorMessages[code]! : "phone.updateFailed");
  }
  if (update?.state === "installing") return t("phone.updateInstalling");
  if (latest && status.appVersionCode !== undefined && latest.versionCode > status.appVersionCode) {
    return t("phone.updateAvailable", { version: latest.versionName });
  }
  if ((update?.state === "prompted" || update?.state === "available") && update.latestVersion) {
    return t("phone.updateAvailable", { version: update.latestVersion });
  }
  return update?.state === "upToDate" ? t("phone.updateCurrent") : null;
}

export function PhoneAppVersion({ phoneId, status }: { phoneId: string; status: PhoneStatus }) {
  const { t } = useI18n();
  const supported = status.appVersionCode !== undefined;
  const { data: latest } = useLoad(() => supported ? fetchLatestPhoneVersion("/download/android/latest.json") : Promise.resolve(undefined), [supported]);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<{ message: string; previousCheck?: string | null }>();
  const update = status.update;
  const signingKeyChange = hasPhoneSigningKeyChange(status, latest);
  const signingKeyMessage = status.deviceOwner ? "phone.updateSigningKeyStrong" : "phone.updateSigningKeyLight";
  const checkedAt = update?.checkedAt;
  const requestPending = request && request.previousCheck === checkedAt;
  const batteryMessage = updateBatteryExemptionMessage(status);
  const batteryUpdateError = update?.errorCode === "battery_exemption_missing";
  const failureDetail = !batteryUpdateError && (update?.state === "failed" || update?.state === "refused") ? update.detail : null;

  async function requestUpdate() {
    setBusy(true);
    setRequest(undefined);
    try {
      await api.post(`/phones/${phoneId}/update`);
      setRequest({ message: t("phone.updateRequested"), previousCheck: checkedAt });
    } catch (e) {
      setRequest({ message: errorMessage(e, t), previousCheck: checkedAt });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <div className="phone-version">
        <span>{t("phone.appVersion", { version: status.appVersion })}</span>
        {supported && !signingKeyChange && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void requestUpdate()}>
            {t("phone.updateNow")}
          </button>
        )}
      </div>
      <div role="status">
        {signingKeyChange ? t(signingKeyMessage) : requestPending ? request.message : !batteryUpdateError && updateMessage(status, latest, t)}
        {batteryMessage && <p>{t(batteryMessage)}</p>}
      </div>
      {!requestPending && failureDetail && (
        <details className="phone-update-details" key={checkedAt}>
          <summary>{t("phone.updateDetails")}</summary>
          <p>{failureDetail}</p>
        </details>
      )}
    </li>
  );
}
