// SPDX-License-Identifier: Apache-2.0
//
// The child's own screen on a paired iPhone: that Plainphone is on, what the phone tells the
// parents (docs/design-principles.md: no hidden monitoring), and the rules sync. The sync runs
// while the app is open and when it comes to the foreground.
// TODO(spike d, docs/ios/spikes.md): background wake-ups (APNs, BGAppRefreshTask) and a nudge to
// open the app when rules have not arrived for a while.
import Constants from "expo-constants";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { nativeScreenTime, type ScreenTimeStatus } from "../../../modules/plainphone-screentime";
import { Button, Card, Loading, Notice, PageTitle, Screen, Stack, Text } from "../../components/ui";
import { useI18n } from "../../i18n/I18n";
import { clearIdentity, deviceFetch, type DeviceIdentity, loadIdentity } from "../../lib/iphone/device-api";
import { emptyMemory, type SyncResult, syncOnce } from "../../lib/iphone/sync";
import { resetWizard } from "../../lib/iphone/wizard";
import { useRole } from "../../lib/role-context";
import { formatTimeOfDay } from "@plainphone/shared/format";

const DEFAULT_POLL_SECONDS = 60;

export default function ChildScreen() {
  const { role } = useRole();
  if (role === null) return <Screen><Loading /></Screen>;
  if (role !== "child") return <Redirect href="/" />;
  return <ChildHome />;
}

type HomeView =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "released" }
  | { kind: "paired"; identity: DeviceIdentity };

function ChildHome() {
  const [view, setView] = useState<HomeView>({ kind: "loading" });
  useEffect(() => {
    void (async () => {
      const identity = await loadIdentity();
      if (identity) return setView({ kind: "paired", identity });
      const status = await nativeScreenTime().status().catch(() => null);
      setView(status?.released ? { kind: "released" } : { kind: "setup" });
    })();
  }, []);
  if (view.kind === "loading") return <Screen><Loading /></Screen>;
  if (view.kind === "setup") return <Redirect href="/child/setup" />;
  if (view.kind === "released") return <Released />;
  return <Paired identity={view.identity} onReleased={() => setView({ kind: "released" })} />;
}

function Paired({ identity, onReleased }: { identity: DeviceIdentity; onReleased: () => void }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const memory = useRef(emptyMemory());
  const [result, setResult] = useState<SyncResult | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sync = useCallback(async () => {
    setBusy(true);
    const r = await syncOnce({
      api: deviceFetch(identity.server),
      identity,
      screenTime: nativeScreenTime(),
      memory: memory.current,
      appVersion: Constants.expoConfig?.version ?? "0",
    });
    setBusy(false);
    setResult(r);
    if (r.outcome === "applied" || r.outcome === "unchanged") setSyncedAt(new Date().toISOString());
    if (r.outcome === "released") {
      await clearIdentity();
      await resetWizard();
      onReleased();
    }
    return r;
  }, [identity, onReleased]);

  // While open: sync now, then every pollSeconds, and again when the app comes back to the front.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const loop = async () => {
      const r = await sync();
      const seconds = "pollSeconds" in r && r.pollSeconds ? r.pollSeconds : DEFAULT_POLL_SECONDS;
      if (!stopped && r.outcome !== "released" && r.outcome !== "unpaired") timer = setTimeout(() => void loop(), seconds * 1000);
    };
    void loop();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void sync();
    });
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [sync]);

  if (result?.outcome === "unpaired") {
    return (
      <Screen testID="child-removed">
        <PageTitle>{t("iphone.child.title")}</PageTitle>
        <Notice tone="warn" text={t("iphone.child.removed")} />
        <Button
          testID="child-setup-again"
          title={t("iphone.child.setupAgain")}
          onPress={() => void clearIdentity().then(resetWizard).then(() => router.replace("/child/setup"))}
        />
      </Screen>
    );
  }
  const status: ScreenTimeStatus | null = result && "status" in result ? result.status : null;
  const permissionOff = status !== null && status.ios.authorizationStatus !== "approved";
  return (
    <Screen testID="child-home" onRefresh={() => void sync()} refreshing={busy}>
      <PageTitle>{t("iphone.child.on")}</PageTitle>
      <Stack>
        <Text>{t("iphone.child.body")}</Text>
        {permissionOff ? <Notice tone="warn" text={t("iphone.child.permissionOff")} /> : null}
        {!permissionOff && status && status.failedPolicies.length > 0 ? <Notice tone="info" text={t("iphone.child.problem")} /> : null}
        {result?.outcome === "offline" ? <Notice tone="info" text={t("iphone.child.offline")} /> : null}
        <Card testID="child-shares">
          <Text variant="label">{t("iphone.child.shares")}</Text>
          <Text>{`• ${t("iphone.child.share1")}`}</Text>
          <Text>{`• ${t("iphone.child.share2")}`}</Text>
          <Text>{`• ${t("iphone.child.share3")}`}</Text>
        </Card>
        {syncedAt ? <Text variant="small">{t("iphone.child.synced", { time: formatTimeOfDay(syncedAt, locale) })}</Text> : null}
        <Button testID="child-sync" kind="secondary" title={t("iphone.child.sync")} busy={busy} onPress={() => void sync()} />
      </Stack>
    </Screen>
  );
}

function Released() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen testID="child-released">
      <PageTitle>{t("iphone.child.title")}</PageTitle>
      <Notice tone="info" text={t("iphone.child.released")} />
      <Button testID="child-setup-again" kind="secondary" title={t("iphone.child.setupAgain")} onPress={() => router.replace("/child/setup")} />
    </Screen>
  );
}
