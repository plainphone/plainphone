// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { coordinateText, type LocationSnapshot, snapshotUntil } from "../lib/extended-family";
import { osmUrl } from "../lib/format";

/**
 * A shared location in a conversation (docs/extended-family.md). While it is live: the time it
 * ends, a plain OpenStreetMap link and the coordinates to copy. After that, only the line.
 */
export function SnapshotLine({ location }: { location: LocationSnapshot | null | undefined }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!location) return <span className="inbox-text">{t("ext.snapshotGone")}</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(coordinateText(location!));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <span className="inbox-text">
        {t("ext.snapshot")} · {t("ext.snapshotUntil", { time: snapshotUntil(location.expiresAt, locale) })}
      </span>
      <span className="actions">
        <a href={osmUrl(location.lat, location.lon)} target="_blank" rel="noopener noreferrer">{t("ext.map")}</a>
        <button type="button" className="btn-link" onClick={() => void copy()}>{t("ext.copyCoords")}</button>
        {copied && <span role="status">{t("ext.copied")}</span>}
      </span>
    </>
  );
}
