// SPDX-License-Identifier: Apache-2.0
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { ChangeResult, PendingChange, Phone } from "../../../api/models";
import { Disclosure, ItemRow } from "../../../components/parts";
import { PhoneGate, pendingWhen, usePhone } from "../../../components/PhoneContext";
import { Button, Card, errorMessage, Field, LinkRow, Notice, PageTitle, Row, Screen, Stack as VStack, Text, useNow } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { space } from "../../../lib/theme";
import { formatAccountTypes, formatList, formatPatchMonth, formatRelative, installWindowOverrunSeconds } from "../../../shared/lib/format";
import { lockStepLabel } from "../../../shared/lib/lock-steps";
import { describeOp } from "../../../shared/lib/ops";

function PendingList() {
  const { t, locale } = useI18n();
  const { pending, reloadPending, appLabel, notify } = usePhone();
  const now = useNow(30_000);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function cancel(c: PendingChange) {
    setBusyId(c.id);
    try {
      await unwrap(client.POST("/changes/{cid}/cancel", { params: { path: { cid: c.id } } }));
      notify({ tone: "success", text: t("pending.cancelled") });
    } catch (err) {
      notify({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t) });
    } finally {
      setBusyId(null);
      await reloadPending();
    }
  }

  if (pending.length === 0) return <Text variant="muted">{t("phone.pendingNone")}</Text>;
  return (
    <VStack gap={space.sm}>
      {pending.map((c) => {
        const what = describeOp(c.op, t, locale, appLabel);
        return (
          <ItemRow key={c.id} testID={`pending-${c.id}`} title={what} meta={pendingWhen(c, now, t, locale)}>
            <Button
              kind="secondary"
              title={t("pending.cancel")}
              accessibilityLabel={`${t("pending.cancel")}: ${what}`}
              busy={busyId === c.id}
              onPress={() => void cancel(c)}
            />
          </ItemRow>
        );
      })}
    </VStack>
  );
}

function RenamePhone() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [name, setName] = useState(phone.name);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function save() {
    const next = name.trim();
    if (!next) {
      setError(t("pair.nameRequired"));
      return;
    }
    setError(undefined);
    if (next === phone.name) return;
    setBusy(true);
    try {
      const p = await unwrap<Phone>(client.PATCH("/phones/{pid}", { params: { path: { pid: phone.id } }, body: { name: next } }));
      setPhone(p);
      setName(p.name);
      notify({ tone: "success", text: t("native.renamed", { name: p.name }) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError(t("pair.nameRequired"));
      else notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">{t("native.renameTitle")}</Text>
      <Field
        testID="rename-name"
        label={t("pair.name")}
        error={error}
        value={name}
        onChangeText={setName}
        maxLength={40}
        autoComplete="off"
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      <Button testID="rename-save" kind="secondary" title={busy ? t("app.saving") : t("app.save")} busy={busy} onPress={() => void save()} />
    </Card>
  );
}

function RemovePhone() {
  const { t } = useI18n();
  const router = useRouter();
  const { phone, run, notify } = usePhone();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const r = await run(() => unwrap<ChangeResult>(client.DELETE("/phones/{pid}", { params: { path: { pid: phone.id } } })));
      setConfirming(false);
      if (r?.status === "applied") {
        AccessibilityInfo.announceForAccessibility(t("native.removed", { name: phone.name }));
        router.dismissTo("/");
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">{t("native.removePhone")}</Text>
      {confirming ? (
        <VStack>
          <Text>{t("native.removeBody", { name: phone.name })}</Text>
          {phone.profile === "self" ? <Text variant="small">{t("native.removeSelfNote")}</Text> : null}
          <Row>
            <Button testID="remove-confirm" kind="danger" title={t("native.removeYes")} busy={busy} onPress={() => void remove()} />
            <Button kind="secondary" title={t("app.cancel")} disabled={busy} onPress={() => setConfirming(false)} />
          </Row>
        </VStack>
      ) : (
        <Button testID="remove-phone" kind="secondary" title={t("native.removePhone")} onPress={() => setConfirming(true)} />
      )}
    </Card>
  );
}

const resetStatus = {
  on: "phone.frpOn",
  off: "phone.frpOff",
  "no-play-services": "phone.frpNoPlay",
  failed: "phone.frpFailed",
} as const;

const systemStatus = {
  verified: "phone.attVerified",
  unlocked: "phone.attUnlocked",
  "custom-os": "phone.attCustomOs",
  "failed-boot": "phone.attFailedBoot",
  revoked: "phone.attRevoked",
  unverifiable: "phone.attUnverifiable",
} as const;

function Overview() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { phone, pending, reloadPhone, reloadPending } = usePhone();
  const now = useNow(60_000);
  const [refreshing, setRefreshing] = useState(false);

  // Coming back from a rule screen, or from the background: the waiting list may have changed.
  useFocusEffect(
    useCallback(() => {
      void reloadPending();
    }, [reloadPending]),
  );

  async function refresh() {
    setRefreshing(true);
    await Promise.all([reloadPhone(), reloadPending()]);
    setRefreshing(false);
  }

  type Section = "apps" | "contacts" | "filter" | "schedules" | "location" | "key";
  const items: { to: Section; label: string; hint?: string }[] = [
    { to: "apps", label: t("phone.apps"), hint: t("phone.appsHint") },
    phone.profile === "self"
      ? { to: "contacts", label: t("contacts.favourites") }
      : { to: "contacts", label: t("phone.contacts"), hint: t("phone.contactsHint") },
    { to: "filter", label: t("phone.filter"), hint: t("phone.filterHint") },
    { to: "schedules", label: t("phone.schedules"), hint: t("phone.schedulesHint") },
    { to: "location", label: t("phone.location"), hint: t(phone.locationEnabled ? "phone.locationHintOn" : "phone.locationHintOff") },
  ];
  if (phone.profile === "self") items.push({ to: "key", label: t("phone.key"), hint: t("phone.keyHint") });

  const overrun = phone.status?.failedPolicies.map(installWindowOverrunSeconds).find((seconds) => seconds !== undefined);
  const status = [
    t(phone.profile === "child" ? "profile.child" : "profile.self"),
    t(phone.mode === "light" ? "mode.light" : "mode.strong"),
    phone.lastSeenAt ? t("phone.lastSeen", { when: formatRelative(phone.lastSeenAt, now, locale) }) : t("phone.neverOnline"),
  ].join(", ");

  const failedPolicies = phone.status?.failedPolicies.filter((policy) => installWindowOverrunSeconds(policy) === undefined) ?? [];
  const reset = phone.status?.resetProtection;
  const system = phone.attestation?.state;
  const patchMonth = formatPatchMonth(phone.attestation?.osPatchLevel, locale);

  return (
    <Screen testID="phone-overview" onRefresh={() => void refresh()} refreshing={refreshing}>
      <PageTitle sub={status}>{phone.name}</PageTitle>
      {phone.mode === "light" ? <Notice tone="info" text={t("mode.lightNote")} /> : null}
      {phone.status?.lateGoogleAccount ? <Notice tone="warn" text={t("phone.lateGoogleAccount")} /> : null}
      {phone.status?.callRoleActionNeeded ? <Notice tone="warn" text={t("phone.callRoleActionNeeded")} /> : null}
      {phone.status?.parallelAppsRemoved ? <Notice tone="info" text={t("phone.parallelAppsRemoved")} /> : null}
      {failedPolicies.length > 0 ? (
        <Notice tone="warn" text={t("phone.lockFailed", { steps: formatList([...new Set(failedPolicies.map((step) => lockStepLabel(step, t, locale)))], locale) })} />
      ) : null}
      {phone.mode === "strong" && phone.pairedAt ? (
        <VStack gap={space.sm}>
          {reset ? <Text>{t(resetStatus[reset])}</Text> : null}
          {phone.status?.accountTypes?.length ? (
            <Text variant="muted">{t("phone.accountTypes", { types: formatAccountTypes(phone.status.accountTypes, locale) })}</Text>
          ) : null}
          {patchMonth ? <Text variant="muted">{t("phone.attPatchMonth", { month: patchMonth })}</Text> : null}
          {system && system !== "verified" && system !== "unverifiable"
            ? <Notice tone="warn" text={t(systemStatus[system])} />
            : <Text variant="muted">{t(system ? systemStatus[system] : "phone.attPending")}</Text>}
          {phone.attestation?.lastFailedAt ? (
            <Text variant="muted">{t("phone.attLastFailedAt", { when: formatRelative(phone.attestation.lastFailedAt, now, locale) })}</Text>
          ) : null}
          {phone.attestation?.checkedAt ? (
            <Text variant="muted">
              {t(phone.attestation.lastFailedAt ? "phone.attFindingAt" : "phone.attCheckedAt", {
                when: formatRelative(phone.attestation.checkedAt, now, locale),
              })}
            </Text>
          ) : null}
        </VStack>
      ) : null}
      {overrun !== undefined ? <Notice tone="warn" text={t("phone.installWindowOverrun")} /> : null}
      {overrun !== undefined || failedPolicies.length > 0 ? (
        <Disclosure title={t("phone.lockDetails")}>
          {overrun !== undefined ? <Text>{t("phone.installWindowOverrunDuration", { seconds: overrun })}</Text> : null}
          {failedPolicies.map((step, index) => <Text key={index}>{step}</Text>)}
        </Disclosure>
      ) : null}

      {phone.profile === "self" || pending.length > 0 ? (
        <VStack>
          <Text variant="heading">{t("phone.pendingTitle")}</Text>
          <PendingList />
        </VStack>
      ) : null}

      <VStack>
        <Text variant="heading">{t("phone.rules")}</Text>
        <VStack gap={space.sm}>
          {items.map((i) => (
            <LinkRow
              key={i.to}
              testID={`section-${i.to}`}
              title={i.label}
              meta={i.hint}
              onPress={() => router.push({ pathname: `/phones/[pid]/${i.to}`, params: { pid: phone.id } })}
            />
          ))}
        </VStack>
      </VStack>

      <VStack>
        <Text variant="heading">{t("native.manage")}</Text>
        <RenamePhone />
        <RemovePhone />
      </VStack>
    </Screen>
  );
}

export default function PhoneOverviewScreen() {
  return (
    <PhoneGate>
      <Overview />
    </PhoneGate>
  );
}
