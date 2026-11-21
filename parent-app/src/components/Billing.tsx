// SPDX-License-Identifier: Apache-2.0
//
// The hosted plan and paid early unlock in the parent app (docs/billing.md). This is a store app,
// so it never sells anything: no upgrade, no payment page, no price for buying and no pointer to where
// one could pay. It shows the plan read-only and, for an early unlock bought elsewhere, its state
// and the withdrawal control, which must always stay reachable. Nothing shows while billing is off.

import { useState } from "react";
import { View } from "react-native";
import { client, unwrap } from "../api/client";
import type { EarlyUnlockPurchase, PendingChange, Plan } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { useMe } from "../lib/session";
import { space } from "../lib/theme";
import { planNowKey, purchaseLine, usageText } from "../shared/lib/billing";
import { intlLocale } from "../shared/lib/format";
import { Button, Card, errorMessage, Field, LiveStatus, type NoticeValue, Row, Stack as VStack, Text, useLoad } from "./ui";

/** The household's plan, or null while loading, on an old server or after any error (= no billing UI). */
export function usePlan(): Plan | null {
  const me = useMe();
  const hid = me.households[0]?.id;
  const res = useLoad<Plan | null>(
    () => (hid ? unwrap<Plan>(client.GET("/households/{hid}/plan", { params: { path: { hid } } })) : Promise.resolve(null)),
    [hid],
  );
  return res.data ?? null;
}

/** Read-only plan: what the household has, usage against limits, and what always stays free. */
export function PlanCard() {
  const { t, locale } = useI18n();
  const plan = usePlan();
  const now = plan ? planNowKey(plan) : null;
  if (!plan || !now) return null;
  const until = plan.until ? new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long" }).format(new Date(plan.until)) : null;
  return (
    <Card testID="plan-card">
      <Text variant="heading">{t("plan.title")}</Text>
      <Text>{t(now)}</Text>
      {plan.plan === "grandfathered" ? <Text>{t("plan.grandfathered")}</Text> : null}
      {plan.plan === "plus" && until ? <Text variant="small">{t("plan.until", { date: until })}</Text> : null}
      {plan.plan === "plus" && plan.source === "play" ? <Text variant="small">{t("plan.playShort")}</Text> : null}
      <VStack gap={space.xs}>
        <Text variant="label">{t("plan.usage")}</Text>
        <Text>{`${t("plan.usage.phones")}: ${usageText(plan.usage.phones, plan.limits.phones, t)}`}</Text>
        <Text>{`${t("plan.usage.trusted")}: ${usageText(plan.usage.trusted, plan.limits.trusted, t)}`}</Text>
      </VStack>
      <VStack gap={space.xs}>
        <Text variant="label">{t("plan.freeTitle")}</Text>
        <Text>{t("plan.freeOne")}</Text>
        <Text>{t("plan.freeNever")}</Text>
      </VStack>
    </Card>
  );
}

/**
 * A bought early unlock on a waiting change: its state and "Withdraw from contract" while it can
 * still be withdrawn. Nothing for an offer without a purchase: the app does not sell.
 */
export function EarlyUnlockStatus({ change, onChanged }: { change: Pick<PendingChange, "id" | "earlyUnlock">; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  // The answer of a withdrawal wins until the reloaded list brings the same purchase again.
  const [answered, setAnswered] = useState<EarlyUnlockPurchase | null>(null);
  const given = change.earlyUnlock?.purchase ?? null;
  const current = answered && answered.id === given?.id ? answered : given;
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  if (!current) return null;
  const line = purchaseLine(current, locale);

  async function confirm() {
    if (!current || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const trimmed = name.trim();
      const p = await unwrap<EarlyUnlockPurchase>(client.POST("/early-unlocks/{id}/withdraw", {
        params: { path: { id: current.id } },
        body: { confirm: true, ...(trimmed ? { name: trimmed } : {}) },
      }));
      setAnswered(p);
      setConfirming(false);
      setNotice({ tone: "success", text: t("early.withdrawDone") });
      onChanged();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View testID={`early-unlock-${change.id}`} style={{ gap: space.sm }}>
      {line ? <Text variant="small">{t(line.key, line.params)}</Text> : null}
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      {current.canWithdraw && !confirming ? (
        <Row>
          <Button testID="early-withdraw" kind="secondary" title={t("early.withdraw")} onPress={() => setConfirming(true)} />
        </Row>
      ) : null}
      {current.canWithdraw && confirming ? (
        <Card testID="early-withdraw-step">
          <Text variant="heading">{t("early.withdraw")}</Text>
          <Text>{t("early.withdrawEffect")}</Text>
          <Text selectable>{t("early.withdrawContract", { id: current.id })}</Text>
          <Text>{t("early.withdrawReceipt", { email: me.user.email })}</Text>
          <Field
            testID="early-withdraw-name"
            label={`${t("early.withdrawName")} (${t("app.optional")})`}
            help={t("early.withdrawNameHelp")}
            value={name}
            onChangeText={setName}
            maxLength={120}
            autoComplete="name"
          />
          <Row>
            <Button testID="early-withdraw-confirm" title={t("early.withdrawConfirm")} busy={busy} onPress={() => void confirm()} />
            <Button kind="secondary" title={t("app.cancel")} disabled={busy} onPress={() => setConfirming(false)} />
          </Row>
        </Card>
      ) : null}
    </View>
  );
}
