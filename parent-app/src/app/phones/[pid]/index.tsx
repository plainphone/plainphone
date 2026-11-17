// SPDX-License-Identifier: Apache-2.0
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { ChangeResult, PendingChange, Phone } from "../../../api/models";
import { ItemRow } from "../../../components/parts";
import { PhoneGate, pendingWhen, usePhone } from "../../../components/PhoneContext";
import { Button, Card, errorMessage, Field, LinkRow, List, Notice, PageTitle, Row, Screen, Section, Text, useNow } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { space } from "../../../lib/theme";
import { formatRelative } from "../../../shared/lib/format";
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

  if (pending.length === 0) return <Text variant="muted" style={{ paddingHorizontal: space.xs }}>{t("phone.pendingNone")}</Text>;
  return (
    <List>
      {pending.map((c) => {
        const what = describeOp(c.op, t, locale, appLabel);
        return (
          <ItemRow key={c.id} testID={`pending-${c.id}`} title={what} meta={pendingWhen(c, now, t, locale)} stacked>
            <Button
              kind="plain"
              title={t("pending.cancel")}
              accessibilityLabel={`${t("pending.cancel")}: ${what}`}
              busy={busyId === c.id}
              onPress={() => void cancel(c)}
            />
          </ItemRow>
        );
      })}
    </List>
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
      <Button
        testID="rename-save"
        kind="secondary"
        title={busy ? t("app.saving") : t("native.renameTitle")}
        busy={busy}
        onPress={() => void save()}
      />
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

  if (!confirming) {
    return <Button testID="remove-phone" kind="destructive" title={t("native.removePhone")} onPress={() => setConfirming(true)} />;
  }
  return (
    <Card>
      <Text variant="heading">{t("native.removePhone")}</Text>
      <Text>{t("native.removeBody", { name: phone.name })}</Text>
      {phone.profile === "self" ? <Text variant="small">{t("native.removeSelfNote")}</Text> : null}
      <Row>
        <Button testID="remove-confirm" kind="danger" title={t("native.removeYes")} busy={busy} onPress={() => void remove()} />
        <Button kind="plain" title={t("app.cancel")} disabled={busy} onPress={() => setConfirming(false)} />
      </Row>
    </Card>
  );
}

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
  const items: { to: Section; label: string; hint: string }[] = [
    { to: "apps", label: t("phone.apps"), hint: t("phone.appsHint") },
    { to: "contacts", label: t("phone.contacts"), hint: t("phone.contactsHint") },
    { to: "filter", label: t("phone.filter"), hint: t("phone.filterHint") },
    { to: "schedules", label: t("phone.schedules"), hint: t("phone.schedulesHint") },
    { to: "location", label: t("phone.location"), hint: t(phone.locationEnabled ? "phone.locationHintOn" : "phone.locationHintOff") },
  ];
  if (phone.profile === "self") items.push({ to: "key", label: t("phone.key"), hint: t("phone.keyHint") });

  const status = [
    t(phone.profile === "child" ? "profile.child" : "profile.self"),
    t(phone.mode === "light" ? "mode.light" : "mode.strong"),
    phone.lastSeenAt ? t("phone.lastSeen", { when: formatRelative(phone.lastSeenAt, now, locale) }) : t("phones.neverSeen"),
  ].join(", ");

  return (
    <Screen testID="phone-overview" onRefresh={() => void refresh()} refreshing={refreshing}>
      <PageTitle sub={status}>{phone.name}</PageTitle>
      {phone.mode === "light" ? <Notice tone="info" text={t("mode.lightNote")} /> : null}

      {phone.profile === "self" || pending.length > 0 ? (
        <Section title={t("phone.pendingTitle")}>
          <PendingList />
        </Section>
      ) : null}

      <Section title={t("phone.rules")}>
        <List>
          {items.map((i) => (
            <LinkRow
              key={i.to}
              testID={`section-${i.to}`}
              title={i.label}
              meta={i.hint}
              onPress={() => router.push({ pathname: `/phones/[pid]/${i.to}`, params: { pid: phone.id } })}
            />
          ))}
        </List>
        <View style={{ height: space.sm }} />
        <List>
          <LinkRow title={t("phone.household")} meta={t("phone.householdHint")} onPress={() => router.push("/household")} />
        </List>
      </Section>

      <Section title={t("native.manage")}>
        <RenamePhone />
        <RemovePhone />
      </Section>
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
