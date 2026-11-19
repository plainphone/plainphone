// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { errorMessage, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey, T } from "../i18n/translate";
import { api, type PhoneStatus } from "../lib/api";
import { updateBatteryExemptionMessage } from "../lib/failedPolicies";

interface LatestVersion {
  versionCode: number;
  versionName: string;
}

async function latestVersion(): Promise<LatestVersion | undefined> {
  const response = await fetch("/download/android/latest.json");
  if (!response.ok) return undefined;
  const release: Partial<LatestVersion> = await response.json();
  if (typeof release.versionCode === "number" && typeof release.versionName === "string") {
    return { versionCode: release.versionCode, versionName: release.versionName };
  }
}

const errorMessages: Readonly<Record<string, MessageKey>> = {
  network: "phone.updateNetwork",
  signature_mismatch: "phone.updateSignatureMismatch",
  version_not_newer: "phone.updateVersionNotNewer",
  metadata_mismatch: "phone.updateMetadataMismatch",
  install_failed: "phone.updateInstallFailed",
  unknown: "phone.updateFailed",
};

function usesProductionKey(version: string | null | undefined): boolean | undefined {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  return Number(major) > 0 || Number(minor) > 1 || (Number(minor) === 1 && Number(patch) >= 10);
}

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
  const { data: latest } = useLoad(() => supported ? latestVersion() : Promise.resolve(undefined), [supported]);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<{ message: string; previousCheck?: string | null }>();
  const update = status.update;
  const reportedOffer = update?.state === "prompted" || update?.state === "available"
    || update?.errorCode === "signature_mismatch" ? update.latestVersion : undefined;
  const signingKeyChange = usesProductionKey(status.appVersion) === false
    && (usesProductionKey(latest?.versionName) === true || usesProductionKey(reportedOffer) === true);
  const signingKeyMessage = status.deviceOwner ? "phone.updateSigningKeyStrong" : "phone.updateSigningKeyLight";
  const checkedAt = update?.checkedAt;
  const requestPending = request && request.previousCheck === checkedAt;
  const batteryMessage = updateBatteryExemptionMessage(status);
  const failureDetail = !batteryMessage && (update?.state === "failed" || update?.state === "refused") ? update.detail : null;

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
        {signingKeyChange ? t(signingKeyMessage) : requestPending ? request.message : !batteryMessage && updateMessage(status, latest, t)}
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
