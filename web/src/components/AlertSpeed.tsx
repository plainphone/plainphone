// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { alertSeconds, fetchLatency } from "../lib/alert-speed";

/** One line in the health card: how fast alerts typically arrive. Nothing until the server has numbers. */
export function AlertSpeed() {
  const { t } = useI18n();
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void fetchLatency().then((stats) => { if (live) setSeconds(alertSeconds(stats)); });
    return () => { live = false; };
  }, []);
  if (seconds === null) return null;
  return (
    <p className="help">
      {t("health.alertSpeed", { n: seconds })}
      <br />
      <small>{t("health.alertSpeedHelp")}</small>
    </p>
  );
}
