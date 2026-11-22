// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { MessageKey } from "@plainphone/i18n/translate";
import { api, type ChangeResult, type OpenCategory, type OpenModeState } from "../lib/api";
import { formatList } from "../lib/format";
import { usePhone } from "./Phone";

const lower = (text: string, locale: string) => text.toLocaleLowerCase(locale === "da" ? "da-DK" : "en-GB");

/**
 * Open mode (docs/open-mode.md): every app is allowed except a block list. One switch for the
 * mode, one switch per category (apps and web filter together) and a one-line summary.
 */
export function OpenModePanel({ onChanged }: { onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { phone, setPhone, run, pending } = usePhone();
  const waiting = pending.filter((c) => c.op.type === "openMode.set" || c.op.type === "openMode.category").length;
  const res = useLoad(() => api.get<OpenModeState>(`/phones/${phone.id}/open-mode`), [phone.id, waiting]);
  const [busy, setBusy] = useState<string | null>(null);
  const waitingCats = new Set(pending.flatMap((c) => (c.op.type === "openMode.category" ? [c.op.category] : [])));
  const waitingToggle = pending.some((c) => c.op.type === "openMode.set");
  const catName = (c: OpenCategory) => t(`open.cat.${c}` as MessageKey);

  async function toggle(enabled: boolean) {
    setBusy("toggle");
    try {
      const r = await run(
        () => api.put<ChangeResult>(`/phones/${phone.id}/open-mode`, { enabled }),
        t(enabled ? "open.onSaved" : "open.offSaved"),
      );
      if (r?.status === "applied") {
        setPhone({ ...phone, openMode: enabled });
        res.setData((d) => d && { ...d, enabled });
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  async function setCategory(category: OpenCategory, blocked: boolean) {
    setBusy(category);
    try {
      const r = await run(
        () => api.put<ChangeResult>(`/phones/${phone.id}/open-mode/categories/${category}`, { blocked }),
        t(blocked ? "open.catBlocked" : "open.catAllowed", { category: catName(category) }),
      );
      if (r?.status === "applied") {
        res.setData((d) => d && { ...d, categories: d.categories.map((c) => (c.category === category ? { ...c, blocked } : c)) });
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  const state = res.data;
  const enabled = state?.enabled ?? phone.openMode ?? false;
  const blockedNames = state
    ? [
        ...state.categories.filter((c) => c.blocked).map((c) => lower(catName(c.category), locale)),
        ...state.blockedApps.map((a) => a.label),
      ]
    : [];
  const summary = !enabled
    ? t("open.summaryOff")
    : blockedNames.length === 0
      ? t("open.summaryNone")
      : t("open.summary", { blocked: formatList(blockedNames, locale) });

  return (
    <section className="section" aria-labelledby="open-mode-title">
      <h2 id="open-mode-title">
        {t("open.title")}
      </h2>
      {(state || !phone.openMode) && (
        <p className="notice notice-info" role="status">
          {summary}
        </p>
      )}
      <ul className="list switch-list">
        <li>
          <Switch
            label={t("open.toggle")}
            description={
              waitingToggle ? (
                <>
                  {t("open.toggleHelp")} <span className="tag tag-waiting">{t("pending.waitingTag")}</span>
                </>
              ) : (
                t("open.toggleHelp")
              )
            }
            checked={enabled}
            busy={busy === "toggle"}
            onChange={(v) => void toggle(v)}
          />
        </li>
      </ul>
      {enabled && state && (
        <>
          <h3 className="h-small">{t("open.categories")}</h3>
          <p className="help">{t("open.categoriesHelp")}</p>
          <ul className="list switch-list">
            {state.categories.map((c) => (
              <li key={c.category}>
                <Switch
                  label={catName(c.category)}
                  description={
                    waitingCats.has(c.category) ? (
                      <>
                        {t(`open.catHelp.${c.category}` as MessageKey)} <span className="tag tag-waiting">{t("pending.waitingTag")}</span>
                      </>
                    ) : (
                      t(`open.catHelp.${c.category}` as MessageKey)
                    )
                  }
                  checked={c.blocked}
                  busy={busy === c.category}
                  onChange={(v) => void setCategory(c.category, v)}
                />
              </li>
            ))}
          </ul>
          {phone.profile === "self" && <p className="help">{t("open.looseningHelp")}</p>}
        </>
      )}
    </section>
  );
}
