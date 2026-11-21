// SPDX-License-Identifier: Apache-2.0
import { useI18n } from "../i18n/I18n";
import { useLiveStatus } from "../lib/live";

/** A dot and a word in the header. The word carries the meaning; the dot is only a hint. Hidden when live updates are off. */
export function LiveIndicator() {
  const { t } = useI18n();
  const status = useLiveStatus();
  if (status === "off") return null;
  return (
    <span className="live-indicator" data-state={status} title={status === "fallback" ? t("live.fallbackHint") : undefined}>
      <span className="live-dot" aria-hidden="true" />
      {t(status === "live" ? "live.on" : status === "connecting" ? "live.connecting" : "live.fallback")}
    </span>
  );
}
