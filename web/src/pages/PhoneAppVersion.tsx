// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { errorMessage, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { T } from "../i18n/translate";
import { api, type PhoneStatus } from "../lib/api";

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

function updateMessage(status: PhoneStatus, latest: LatestVersion | undefined, t: T) {
  const update = status.update;
  if (update?.state === "failed" || update?.state === "refused") {
    return t("phone.updateFailed", { reason: update.detail ?? t("phone.updateUnknown") });
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
  const checkedAt = status.update?.checkedAt;

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
        {supported && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void requestUpdate()}>
            {t("phone.updateNow")}
          </button>
        )}
      </div>
      <div role="status">
        {request && request.previousCheck === checkedAt ? request.message : updateMessage(status, latest, t)}
      </div>
    </li>
  );
}
