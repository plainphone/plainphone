// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useState } from "react";
import { Field, LoadGate, PageTitle, Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type ChangeResult, DNS_CATEGORIES, type DnsCategory, type DnsState } from "../lib/api";
import { categoryLabel } from "../lib/ops";
import { usePhone } from "./Phone";

/** Roughly the server's rule; the server has the final word. */
export function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^\*\./, "")
    .replace(/\.$/, "");
}
export const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

export function FilterPage() {
  const { t } = useI18n();
  const { phone, run, pending } = usePhone();
  const res = useLoad(() => api.get<DnsState>(`/phones/${phone.id}/dns`), [phone.id]);
  const [busy, setBusy] = useState<string | null>(null);

  const waitingCats = new Set(pending.flatMap((c) => (c.op.type === "dns.category" ? [c.op.category] : [])));

  async function setCategory(cat: DnsCategory, blocked: boolean) {
    setBusy(cat);
    const r = await run(() => api.put<ChangeResult>(`/phones/${phone.id}/dns/categories/${cat}`, { blocked }));
    if (r?.status === "applied") {
      res.setData((d) =>
        d && {
          ...d,
          blockedCategories: blocked ? [...d.blockedCategories.filter((c) => c !== cat), cat] : d.blockedCategories.filter((c) => c !== cat),
        },
      );
    }
    setBusy(null);
  }

  return (
    <>
      <PageTitle sub={t("filter.intro")}>{t("filter.title")}</PageTitle>
      <LoadGate res={res}>
        {(dns) => (
          <>
            {!dns.synced && <p className="notice notice-info">{t("filter.notSynced")}</p>}
            <section className="section" aria-labelledby="cat-h">
              <h2 id="cat-h">{t("filter.categories")}</h2>
              <p className="help">{t("filter.categoriesHelp")}</p>
              <ul className="list switch-list">
                {DNS_CATEGORIES.map((cat) => (
                  <li key={cat}>
                    <Switch
                      label={categoryLabel(cat, t)}
                      checked={dns.blockedCategories.includes(cat)}
                      busy={busy === cat}
                      description={waitingCats.has(cat) ? <span className="tag tag-waiting">{t("pending.waitingTag")}</span> : undefined}
                      onChange={(v) => void setCategory(cat, v)}
                    />
                  </li>
                ))}
              </ul>
            </section>
            <DomainList kind="allow" domains={dns.allowDomains} onChanged={() => void res.reload()} />
            <DomainList kind="block" domains={dns.blockDomains} onChanged={() => void res.reload()} />
            <details className="details">
              <summary>{t("filter.technical")}</summary>
              <p>
                {t("filter.host")}: <code>{dns.host}</code>
              </p>
            </details>
          </>
        )}
      </LoadGate>
    </>
  );
}

function DomainList({ kind, domains, onChanged }: { kind: "allow" | "block"; domains: string[]; onChanged: () => void }) {
  const { t } = useI18n();
  const { phone, run, pending } = usePhone();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const opType = kind === "allow" ? "dns.allowDomain" : "dns.blockDomain";
  const waiting = pending.flatMap((c) => (c.op.type === opType && c.op.present ? [c.op.domain] : []));
  const headingId = `${kind}-h`;

  async function add(e: FormEvent) {
    e.preventDefault();
    const domain = cleanDomain(value);
    if (!DOMAIN_RE.test(domain)) {
      setError(t("filter.domainInvalid"));
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const r = await run(() => api.post<ChangeResult>(`/phones/${phone.id}/dns/${kind}`, { domain }), t(kind === "allow" ? "op.allowAdd" : "op.blockAdd", { domain }) + ".");
      if (r) {
        setValue("");
        if (r.status === "applied") onChanged();
      }
    } catch (err) {
      if (err instanceof ApiError) setError(t("filter.domainInvalid"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(domain: string) {
    setRemoving(domain);
    const r = await run(
      () => api.del<ChangeResult>(`/phones/${phone.id}/dns/${kind}/${encodeURIComponent(domain)}`),
      t(kind === "allow" ? "op.allowRemove" : "op.blockRemove", { domain }) + ".",
    );
    if (r?.status === "applied") onChanged();
    setRemoving(null);
  }

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t(kind === "allow" ? "filter.allowTitle" : "filter.blockTitle")}</h2>
      <p className="help">{t(kind === "allow" ? "filter.allowHelp" : "filter.blockHelp")}</p>
      {domains.length === 0 && waiting.length === 0 ? (
        <p className="empty-inline">{t(kind === "allow" ? "filter.noneAllowed" : "filter.noneBlocked")}</p>
      ) : (
        <ul className="list item-list">
          {domains.map((d) => (
            <li key={d} className="item">
              <span className="domain">{d}</span>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => void remove(d)}
                disabled={removing === d}
                aria-label={t("filter.removeLabel", { domain: d })}
              >
                {t("app.remove")}
              </button>
            </li>
          ))}
          {waiting.map((d) => (
            <li key={`w-${d}`} className="item item-waiting">
              <span className="domain">{d}</span>
              <span className="tag tag-waiting">{t("pending.waitingTag")}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate className="inline-form">
        <Field label={t("filter.domain")} error={error}>
          {(p) => (
            <input
              {...p}
              name={`${kind}-domain`}
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="off"
              placeholder={t("filter.domainPlaceholder")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {t(kind === "allow" ? "filter.allowAdd" : "filter.blockAdd")}
        </button>
      </form>
    </section>
  );
}
