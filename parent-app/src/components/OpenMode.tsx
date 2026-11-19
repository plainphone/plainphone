// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { client, unwrap } from "../api/client";
import type { ChangeResult, OpenCategory, OpenModeState } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { space } from "../lib/theme";
import type { MessageKey } from "../shared/i18n/translate";
import { formatList } from "../shared/lib/format";
import { usePhone } from "./PhoneContext";
import { Card, errorMessage, Notice, Stack as VStack, Switch, Text, useLoad } from "./ui";

const lower = (text: string, locale: string) => text.toLocaleLowerCase(locale === "da" ? "da-DK" : "en-GB");

/**
 * Open mode (docs/open-mode.md): every app is allowed except a block list. One switch for the
 * mode, one per category (apps and web filter together) and a one-line summary.
 */
export function OpenModePanel({ onChanged }: { onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { phone, setPhone, run, pending, notify } = usePhone();
  const waiting = pending.filter((c) => c.op.type === "openMode.set" || c.op.type === "openMode.category").length;
  const res = useLoad(
    () => unwrap<OpenModeState>(client.GET("/phones/{pid}/open-mode", { params: { path: { pid: phone.id } } })),
    [phone.id, waiting],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const waitingCats = new Set(pending.flatMap((c) => (c.op.type === "openMode.category" ? [c.op.category] : [])));
  const waitingToggle = pending.some((c) => c.op.type === "openMode.set");
  const catName = (c: OpenCategory) => t(`open.cat.${c}` as MessageKey);

  async function toggle(enabled: boolean) {
    setBusy("toggle");
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(
            client.PUT("/phones/{pid}/open-mode", { params: { path: { pid: phone.id } }, body: { enabled } }),
          ),
        t(enabled ? "open.onSaved" : "open.offSaved"),
      );
      if (r?.status === "applied") {
        setPhone({ ...phone, openMode: enabled });
        res.setData((d) => d && { ...d, enabled });
        onChanged();
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  }

  async function setCategory(category: OpenCategory, blocked: boolean) {
    setBusy(category);
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(
            client.PUT("/phones/{pid}/open-mode/categories/{category}", {
              params: { path: { pid: phone.id, category } },
              body: { blocked },
            }),
          ),
        t(blocked ? "open.catBlocked" : "open.catAllowed", { category: catName(category) }),
      );
      if (r?.status === "applied") {
        res.setData((d) => d && { ...d, categories: d.categories.map((c) => (c.category === category ? { ...c, blocked } : c)) });
        onChanged();
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  }

  const state = res.data;
  if (!state) return null;
  const blockedNames = [
    ...state.categories.filter((c) => c.blocked).map((c) => lower(catName(c.category), locale)),
    ...state.blockedApps.map((a) => a.label),
  ];
  const summary = !state.enabled
    ? t("open.summaryOff")
    : blockedNames.length === 0
      ? t("open.summaryNone")
      : t("open.summary", { blocked: formatList(blockedNames, locale) });

  return (
    <VStack>
      <Text variant="heading">{t("open.title")}</Text>
      <Notice tone="info" text={summary} />
      <Switch
        testID="open-mode"
        label={t("open.toggle")}
        value={state.enabled}
        disabled={busy === "toggle"}
        help={waitingToggle ? t("pending.waitingTag") : t("open.toggleHelp")}
        onValueChange={(v) => void toggle(v)}
      />
      {state.enabled ? (
        <VStack>
          <Text variant="heading">{t("open.categories")}</Text>
          <Text variant="small">{t("open.categoriesHelp")}</Text>
          <Card style={{ gap: space.xs }}>
            {state.categories.map((c) => (
              <Switch
                key={c.category}
                testID={`open-category-${c.category}`}
                label={catName(c.category)}
                value={c.blocked}
                disabled={busy === c.category}
                help={waitingCats.has(c.category) ? t("pending.waitingTag") : t(`open.catHelp.${c.category}` as MessageKey)}
                onValueChange={(v) => void setCategory(c.category, v)}
              />
            ))}
          </Card>
          {phone.profile === "self" ? <Text variant="small">{t("open.looseningHelp")}</Text> : null}
        </VStack>
      ) : null}
    </VStack>
  );
}
