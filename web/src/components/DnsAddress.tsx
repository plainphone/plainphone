// SPDX-License-Identifier: Apache-2.0
import { useId, useState } from "react";
import { useI18n } from "../i18n/I18n";

const DOT_PORT = 853;

export function DnsAddress({ host }: { host: string | null }) {
  const { t } = useI18n();
  const heading = useId();
  if (!host) return null;

  return (
    <section className="section" aria-labelledby={heading}>
      <h2 id={heading}>{t("filter.addressTitle")}</h2>
      <p>{t("filter.addressLimits")}</p>
      <p>{t("filter.addressSharing")}</p>
      <p>{t("filter.addressStatus")}</p>
      <ul className="list item-list">
        <CopyAddress label={t("filter.addressHostname")} value={host} />
        <li className="item">{t("filter.addressPort", { port: DOT_PORT })}</li>
        <CopyAddress label={t("filter.addressTls")} value={`tls://${host}:${DOT_PORT}`} />
      </ul>
      <details className="details">
        <summary>{t("filter.addressAndroidTitle")}</summary>
        <p>{t("filter.addressAndroid")}</p>
      </details>
      <details className="details">
        <summary>Tailscale</summary>
        <p className="help">{t("filter.addressUnverified")}</p>
        <p>{t("filter.addressTailscale")}</p>
        <p>{t("filter.addressTailscaleAdmin")}</p>
      </details>
      <details className="details">
        <summary>{t("filter.addressRouterTitle")}</summary>
        <p>{t("filter.addressRouter")}</p>
        <p>{t("filter.addressCompany")} {t("filter.addressUnverified")}</p>
      </details>
    </section>
  );
}

function CopyAddress({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(t("filter.addressCopied"));
    } catch {
      setStatus(t("filter.addressCopyFailed"));
    }
  }

  return (
    <li className="item item-stack">
      <div>
        <div>{label}</div>
        <code>{value}</code>
      </div>
      <div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={t("filter.addressCopyLabel", { label })}
          onClick={() => void copy()}
        >
          {t("filter.addressCopy")}
        </button>
        <div role="status">{status}</div>
      </div>
    </li>
  );
}
