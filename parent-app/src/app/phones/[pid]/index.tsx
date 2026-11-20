// SPDX-License-Identifier: Apache-2.0
import { languageNames, messageLanguage, type PhoneLanguage } from "../../../shared/lib/phone-language";
import { SosOptions } from "../../../components/SosOptions";
import { SosPanel } from "../../../components/SosPanel";
import { filterStatusKey } from "../../../shared/lib/filter-status";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Linking, Switch as NativeSwitch } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { ChangeResult, Home, PendingChange, Phone } from "../../../api/models";
import { MoreTimeRequests } from "../../../components/MoreTimeRequests";
import { PhoneSupport, ReleaseNotice } from "../../../components/PhoneSupport";
import { PhoneSwitch } from "../../../components/BedtimeSettings";
import { AppUpdates } from "../../../components/AppUpdates";
import { PhoneDisplayPreferences } from "../../../components/PhoneDisplayPreferences";
import { PhoneLanguagePicker } from "../../../components/PhoneLanguagePicker";
import { Disclosure, ItemRow } from "../../../components/parts";
import { PhoneGate, pendingWhen, usePhone } from "../../../components/PhoneContext";
import { Button, Card, Choice, errorMessage, Field, LinkRow, LoadGate, Notice, PageTitle, Row, Screen, Stack as VStack, Switch, Text, useLoad, useNow } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { SERVER_URL } from "../../../lib/config";
import { space } from "../../../lib/theme";
import { formatAccountTypes, formatList, formatPatchMonth, formatRelative, installWindowOverrunSeconds } from "../../../shared/lib/format";
import { phoneStateText } from "../../../lib/phoneStateText";
import { BATTERY_EXEMPTION_POLICY, updateBatteryExemptionMessage } from "../../../shared/lib/failedPolicies";
import { lockStepLabel } from "../../../shared/lib/lock-steps";
import { HOME_PALETTES } from "../../../shared/lib/settings";
import { describeOp } from "../../../shared/lib/ops";
import { appUpdateReceiptLine } from "../../../shared/lib/app-updates";
import { healthRows, receiptText } from "../../../shared/lib/phone-health";
import { fetchLatestPhoneVersion, hasPhoneSigningKeyChange, usesProductionKey, type LatestVersion } from "../../../shared/lib/phoneUpdate";

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
        const what = c.summary?.[messageLanguage(locale)] ?? describeOp(c.op, t, locale, appLabel);
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

function ServerMoveToggle() {
  const { t } = useI18n();
  const { phone, pending, run, setPhone } = usePhone();
  const [working, setWorking] = useState(false);
  const waiting = pending.some((change) => change.op.type === "move.allow");

  async function update(allowed: boolean) {
    setWorking(true);
    try {
      const result = await run(() => unwrap(client.PUT("/phones/{pid}/server-move/allow", {
        params: { path: { pid: phone.id } },
        body: { allowed },
      })), t("move.allowed"));
      if (result?.status === "applied") setPhone({ ...phone, allowServerMove: allowed });
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card>
      <Switch label={t("move.allow")} value={phone.allowServerMove ?? phone.profile === "child"}
        disabled={working || waiting} onValueChange={(allowed) => void update(allowed)} />
      <Text variant="muted">{t("move.help")}</Text>
    </Card>
  );
}

function PushPreferences() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [alerts, setAlerts] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    let current = true;
    void unwrap<{ mutedPhoneIds: string[] }>(client.GET("/notifications")).then((settings) => {
      if (current) setAlerts(!settings.mutedPhoneIds.includes(phone.id));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [phone.id]));

  async function save(field: "alerts" | "wakeups" | "googleFree", enabled: boolean) {
    setBusy(true);
    const params = { path: { pid: phone.id } };
    try {
      if (field === "alerts") {
        await unwrap(client.PUT("/phones/{pid}/notifications", { params, body: { enabled } }));
        setAlerts(enabled);
      } else {
        setPhone(await unwrap<Phone>(client.PATCH("/phones/{pid}", { params, body: field === "wakeups" ? { pushWakeups: enabled } : { preferUnifiedPush: enabled } })));
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  if (alerts === null && phone.pushWakeups === undefined) return null;
  return (
    <Card>
      {phone.pushWakeups !== undefined ? (
        <>
          <Row>
            <Text variant="label" style={{ flex: 1 }}>{t("phone.pushWakeups")}</Text>
            <NativeSwitch accessibilityLabel={t("phone.pushWakeups")} accessibilityHint={t("phone.pushWakeupsHelp")}
              disabled={busy} value={phone.pushWakeups} onValueChange={(value) => void save("wakeups", value)} />
          </Row>
          <Text variant="muted">{t("phone.pushWakeupsHelp")}</Text>
          {phone.pushWakeups && phone.preferUnifiedPush !== undefined ? (
            <>
              <Row>
                <Text variant="label" style={{ flex: 1 }}>{t("phone.pushGoogleFree")}</Text>
                <NativeSwitch accessibilityLabel={t("phone.pushGoogleFree")} accessibilityHint={t("phone.pushGoogleFreeHelp")}
                  disabled={busy} value={phone.preferUnifiedPush} onValueChange={(value) => void save("googleFree", value)} />
              </Row>
              <Text variant="muted">{t("phone.pushGoogleFreeHelp")}</Text>
            </>
          ) : null}
        </>
      ) : null}
      {alerts !== null ? (
        <>
          <Row>
            <Text variant="label" style={{ flex: 1 }}>{t("phone.pushAlerts")}</Text>
            <NativeSwitch accessibilityLabel={t("phone.pushAlerts")} accessibilityHint={t("phone.pushAlertsHelp")}
              disabled={busy} value={alerts} onValueChange={(value) => void save("alerts", value)} />
          </Row>
          <Text variant="muted">{t("phone.pushAlertsHelp")}</Text>
        </>
      ) : null}
    </Card>
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

function FreePromiseSetting() {
  const { t } = useI18n();
  const { phone, run, notify } = usePhone();
  const params = { path: { pid: phone.id } };
  const res = useLoad(() => unwrap<Home & { showFreePromise?: boolean }>(client.GET("/phones/{pid}/home", { params })), [phone.id]);
  const [busy, setBusy] = useState(false);

  async function save(showFreePromise: boolean) {
    setBusy(true);
    try {
      const result = await run(() =>
        unwrap<ChangeResult>(client.PATCH("/phones/{pid}/home", { params, body: { showFreePromise } })),
      );
      if (result?.status === "applied") res.setData((home) => home && { ...home, showFreePromise });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function savePalette(home: Home, palette: Home["palette"]) {
    setBusy(true);
    try {
      const result = await run(() =>
        unwrap<ChangeResult>(client.PUT("/phones/{pid}/home", {
          params,
          body: { layout: home.layout, theme: home.theme, palette, apps: home.apps },
        })),
      );
      if (result?.status === "applied") res.setData((current) => current && { ...current, palette });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <LoadGate res={res}>
        {(home) => (
          <>
            <Choice
              label={t("home.palette")}
              value={home.palette}
              disabled={busy}
              onChange={(palette) => void savePalette(home, palette)}
              options={HOME_PALETTES.map((value) => ({ value, label: t(`home.palette.${value}` as const) }))}
            />
            <Switch
              label={t("home.freePromise")}
              help={t("home.freePromiseHelp")}
              value={home.showFreePromise ?? true}
              disabled={busy}
              onValueChange={(value) => void save(value)}
            />
          </>
        )}
      </LoadGate>
    </Card>
  );
}

function PhoneLanguageSettings() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [busy, setBusy] = useState(false);

  async function save(fields: { language: PhoneLanguage } | { lockSystemLanguage: boolean }) {
    setBusy(true);
    try {
      const updated = await unwrap<Phone>(client.PATCH("/phones/{pid}", {
        params: { path: { pid: phone.id } }, body: fields,
      }));
      setPhone(updated);
      if ("language" in fields && updated.setupQrAvailable) {
        notify({ tone: "info", text: t("add.setupChanged") });
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Disclosure title={`${t("phoneLanguage.label")} (${phone.language ? languageNames[phone.language] : t("phoneLanguage.system")})`}>
        <PhoneLanguagePicker value={phone.language ?? null} onChange={(value) => {
          if (value !== (phone.language ?? null)) void save({ language: value });
        }} disabled={busy} />
      </Disclosure>
      {phone.mode === "strong" && phone.profile === "child" && (
        <Switch
          label={t("phoneLanguage.lockSystem")}
          help={t("phoneLanguage.lockSystemHelp")}
          value={phone.lockSystemLanguage ?? true}
          disabled={busy}
          onValueChange={(lockSystemLanguage) => void save({ lockSystemLanguage })}
        />
      )}
      {phone.setupQrAvailable && (
        <Button kind="secondary" title={t("phoneLanguage.browser")} onPress={() => {
          void Linking.openURL(`${SERVER_URL}/phones/${phone.id}/setup`).catch((err) => {
            notify({ tone: "error", text: errorMessage(err, t) });
          });
        }} />
      )}
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

/** What the release metadata said: still asking, could not be read, or the latest version. */
type LatestCheck = { state: "checking" } | { state: "failed" } | { state: "done"; latest: LatestVersion };

/** `refreshKey` changes on pull-to-refresh: the metadata is asked again, as it is whenever the screen gets focus. */
function PhoneAppVersion({ phoneId, status, refreshKey }: { phoneId: string; status: NonNullable<Phone["status"]>; refreshKey: number }) {
  const { t } = useI18n();
  const { notify } = usePhone();
  const [busy, setBusy] = useState(false);
  const batteryMessage = updateBatteryExemptionMessage(status);
  const supported = status.appVersionCode !== undefined;
  const checkSigningKey = supported && usesProductionKey(status.appVersion) === false;
  const [check, setCheck] = useState<LatestCheck>({ state: "checking" });
  const signingKeyChange = hasPhoneSigningKeyChange(status, check.state === "done" ? check.latest : undefined);
  // A phone on the old signing key must not be asked to update before we know the next version
  // is signed the same way (an update it would refuse), so a failed check keeps the button off.
  const unchecked = checkSigningKey && check.state !== "done";

  useFocusEffect(useCallback(() => {
    if (!checkSigningKey) return;
    let active = true;
    setCheck({ state: "checking" });
    void fetchLatestPhoneVersion(`${SERVER_URL}/download/android/latest.json`)
      .catch(() => undefined)
      .then((latest) => { if (active) setCheck(latest ? { state: "done", latest } : { state: "failed" }); });
    return () => { active = false; };
  }, [checkSigningKey, refreshKey]));

  async function requestUpdate() {
    setBusy(true);
    try {
      await unwrap(client.POST("/phones/{pid}/update", { params: { path: { pid: phoneId } } }));
      notify({ tone: "success", text: t("phone.updateRequested") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={space.sm}>
      <Row>
        <Text>{t("phone.appVersion", { version: status.appVersion })}</Text>
        {supported && !signingKeyChange ? (
          <Button kind="secondary" title={t("phone.updateNow")} busy={busy || (unchecked && check.state === "checking")}
            disabled={unchecked && check.state === "failed"} onPress={() => void requestUpdate()} />
        ) : null}
      </Row>
      {supported && !signingKeyChange && unchecked && check.state === "failed" ? <Notice tone="info" text={t("phone.updateCheckFailed")} /> : null}
      {signingKeyChange ? <Notice tone="warn" text={t(status.deviceOwner ? "phone.updateSigningKeyStrong" : "phone.updateSigningKeyLight")} /> : null}
      {batteryMessage ? <Notice tone="warn" text={t(batteryMessage)} /> : null}
    </VStack>
  );
}

function Overview() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { phone, pending, reloadPhone, reloadPending, setPhone } = usePhone();
  const now = useNow(60_000);
  const [refreshing, setRefreshing] = useState(false);
  const [updateCheck, setUpdateCheck] = useState(0);

  // Coming back from a rule screen, or from the background: the waiting list may have changed.
  useFocusEffect(
    useCallback(() => {
      void reloadPending();
    }, [reloadPending]),
  );

  const releasing = Boolean(phone.releaseRequestedAt);
  useFocusEffect(useCallback(() => {
    if (!phone.pairedAt) return;
    let active = true;
    const timer = setInterval(() => {
      void unwrap<Phone>(client.GET("/phones/{pid}", { params: { path: { pid: phone.id } } }))
        .then((latest) => { if (active) setPhone(latest); })
        .catch((error) => {
          if (active && releasing && error instanceof ApiError && error.status === 404) {
            router.dismissTo({ pathname: "/", params: { notice: "phone-unavailable" } });
          }
        });
    }, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [phone.id, phone.pairedAt, releasing, router, setPhone]));

  async function refresh() {
    setRefreshing(true);
    setUpdateCheck((n) => n + 1);
    await Promise.all([reloadPhone(), reloadPending()]);
    setRefreshing(false);
  }

  type Section = "apps" | "contacts" | "filter" | "time" | "schedules" | "location" | "key";
  type Item = { to: Section; label: string; hint?: string };
  // The same groups, in the same order, as the web dashboard's rule list.
  const groups: { title: string; items: Item[] }[] = [
    {
      title: t("phone.rulesPeople"),
      items: [
        { to: "apps", label: t("phone.apps"), hint: t("phone.appsHint") },
        phone.profile === "self"
          ? { to: "contacts", label: t("contacts.favourites") }
          : { to: "contacts", label: t("phone.contacts"), hint: t("phone.contactsHint") },
        { to: "filter", label: t("phone.filter"), hint: t("phone.filterHint") },
      ],
    },
    {
      title: t("phone.rulesWhen"),
      items: [
        { to: "time", label: t("phone.time"), hint: t("phone.timeHint") },
        { to: "schedules", label: t("phone.schedules"), hint: t("phone.schedulesHint") },
      ],
    },
    {
      title: t("phone.rulesDevice"),
      items: [
        { to: "location", label: t("phone.location"), hint: t(phone.locationEnabled ? "phone.locationHintOn" : "phone.locationHintOff") },
        ...(phone.profile === "self" ? [{ to: "key" as const, label: t("phone.key"), hint: t("phone.keyHint") }] : []),
      ],
    },
  ];

  const state = phoneStateText(phone, now, t, locale);
  const showHealth = phone.healthBoardEnabled !== false;
  const filterStatus = filterStatusKey(phone.status);
  const overrun = phone.status?.failedPolicies.map(installWindowOverrunSeconds).find((seconds) => seconds !== undefined);
  const status = [
    t(phone.profile === "child" ? "profile.child" : "profile.self"),
    t(phone.mode === "light" ? "mode.light" : "mode.strong"),
    state.title,
  ].join(", ");

  const failedPolicies = phone.status?.failedPolicies.filter((policy) => installWindowOverrunSeconds(policy) === undefined) ?? [];
  const technicalSteps = failedPolicies.filter((step) => step !== BATTERY_EXEMPTION_POLICY);
  const reset = phone.status?.resetProtection;
  const system = phone.attestation?.state;
  const patchMonth = formatPatchMonth(phone.attestation?.osPatchLevel, locale);
  // An open app update window: Play is shown for a while, which the confirmed rules do not say.
  const updating = phone.mode === "strong" ? appUpdateReceiptLine(phone.status?.appUpdates, now, locale) : null;

  return (
    <Screen testID="phone-overview" onRefresh={() => void refresh()} refreshing={refreshing}>
      <PageTitle sub={status}>{phone.name}</PageTitle>
      {phone.profile === "child" && <SosPanel key={phone.id} pid={phone.id} />}
      {phone.profile === "child" && <SosOptions key={`sos-options-${phone.id}`} pid={phone.id} />}
      <Notice tone={state.attention ? "warn" : "info"} text={state.hint} />
      {phone.awaitingServerMove ? <Notice tone="info" text={t("move.waiting")} /> : null}
      {showHealth ? (
        <Card>
          <Text variant="heading">{t("health.title")}</Text>
          {healthRows(phone, now, locale, t).map(({ key, label, detail, action }) => (
            <VStack key={key} gap={space.xs}>
              <Text variant="label">{label}</Text>
              <Text variant={action ? "error" : "muted"}>{detail}</Text>
            </VStack>
          ))}
        </Card>
      ) : filterStatus ? <Notice tone={phone.status?.filterWorking ? "info" : "warn"} text={t(filterStatus)} /> : null}
      {phone.mode === "light" ? <Notice tone="info" text={t("mode.lightNote")} /> : null}
      {phone.status?.lateGoogleAccount ? <Notice tone="warn" text={t("phone.lateGoogleAccount")} /> : null}
      {!showHealth && phone.status?.callRoleActionNeeded ? <Notice tone="warn" text={t("phone.callRoleActionNeeded")} /> : null}
      {phone.status?.parallelAppsRemoved ? <Notice tone="info" text={t("phone.parallelAppsRemoved")} /> : null}
      {technicalSteps.length > 0 ? (
        <Notice tone="warn" text={t("phone.lockFailed", { steps: formatList([...new Set(technicalSteps.map((step) => lockStepLabel(step, t, locale)))], locale) })} />
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
      <ReleaseNotice />
      {phone.status?.appVersion ? <PhoneAppVersion key={phone.id} phoneId={phone.id} status={phone.status} refreshKey={updateCheck} /> : null}
      {overrun !== undefined ? <Notice tone="warn" text={t("phone.installWindowOverrun")} /> : null}
      {overrun !== undefined || technicalSteps.length > 0 ? (
        <Disclosure title={t("phone.lockDetails")}>
          {overrun !== undefined ? <Text>{t("phone.installWindowOverrunDuration", { seconds: overrun })}</Text> : null}
          {technicalSteps.map((step, index) => <Text key={index}>{step}</Text>)}
        </Disclosure>
      ) : null}

      {phone.profile === "child" && phone.pairedAt ? <MoreTimeRequests key={`more-time-${phone.id}`} /> : null}

      {phone.profile === "self" || pending.length > 0 ? (
        <VStack>
          <Text variant="heading">{t("phone.pendingTitle")}</Text>
          <PendingList />
        </VStack>
      ) : null}

      <VStack>
        <Text variant="heading">{t("phone.rules")}</Text>
        {phone.changeReceiptsEnabled !== false && phone.ruleReceipt && (
          <Card>
            <Text variant="label">{t("receipt.title")}</Text>
            <Text accessibilityLiveRegion="polite">{receiptText(phone.ruleReceipt, phone, now, locale, t)}</Text>
            {updating && <Text>{t(updating.key, updating.params)}</Text>}
          </Card>
        )}
        {groups.map((g) => (
          <VStack key={g.title} gap={space.sm}>
            <Text variant="label">{g.title}</Text>
            {g.items.map((i) => (
              <LinkRow
                key={i.to}
                testID={`section-${i.to}`}
                title={i.label}
                meta={i.hint}
                onPress={() => router.push({ pathname: `/phones/[pid]/${i.to}`, params: { pid: phone.id } })}
              />
            ))}
          </VStack>
        ))}
      </VStack>

      <VStack>
        <Text variant="heading">{t("native.manage")}</Text>
        <PhoneSupport />
        <PushPreferences />
        {phone.pairedAt ? <ServerMoveToggle /> : null}
        <FreePromiseSetting key={phone.id} />
        <AppUpdates />
        <PhoneDisplayPreferences />
        {phone.profile === "child" && phone.pairedAt ? (
          <Card>
            <PhoneSwitch field="pinApprovalEnabled" label={t("pin.toggle")} help={t("pin.help")} />
          </Card>
        ) : null}
        <RenamePhone />
        <PhoneLanguageSettings />
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
