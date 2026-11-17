// SPDX-License-Identifier: Apache-2.0
//
// The phone being managed, loaded once for all its screens (overview, apps, contacts, ...):
// the phone itself, the changes waiting for its key, the apps' names, and run(), which
// reports what a rule change did. Same job as PhoneLayout in web/src/pages/Phone.tsx.
import { usePathname } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Keyboard, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, client, unwrap } from "../api/client";
import type { App, ChangeResult, Locale, PendingChange, Phone } from "../api/models";
import { type TFn, useI18n } from "../i18n/I18n";
import { radius, space, useColors } from "../lib/theme";
import { formatDateTime, formatDuration } from "../shared/lib/format";
import { describeOp } from "../shared/lib/ops";
import { Button, ErrorState, errorMessage, LiveStatus, Loading, type NoticeValue, Row, Screen, Text, useLoad, useNow } from "./ui";

export interface PhoneCtx {
  phone: Phone;
  setPhone: (p: Phone) => void;
  reloadPhone: () => Promise<void>;
  pending: PendingChange[];
  reloadPending: () => Promise<void>;
  appLabel: (pkg: string) => string;
  setApps: (apps: App[]) => void;
  /**
   * Runs a rule change and reports the outcome: a short note when applied, the waiting
   * banner when the key holds it back. Validation errors (400 with issues) are rethrown
   * so forms can show them inline; other errors become a notice and return null.
   */
  run: (fn: () => Promise<ChangeResult>, appliedText?: string) => Promise<ChangeResult | null>;
  notify: (n: NoticeValue | null) => void;
}

/** What the provider holds. The phone is missing while it loads or when loading failed. */
interface Held extends Omit<PhoneCtx, "phone"> {
  phone: Phone | null;
  error: unknown;
}

const Ctx = createContext<Held | null>(null);

function useHeld(): Held {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePhone outside PhoneProvider");
  return v;
}

/** The loaded phone and its helpers. Only use inside <PhoneGate>. */
export function usePhone(): PhoneCtx {
  const v = useHeld();
  if (!v.phone) throw new Error("usePhone before the phone has loaded; wrap the screen in <PhoneGate>");
  return v as PhoneCtx;
}

/** The phone's name for headers; empty until it has loaded. */
export function usePhoneName(): string {
  return useHeld().phone?.name ?? "";
}

export function durationWords(t: TFn) {
  return {
    hm: t("duration.hm"),
    h: t("duration.h"),
    m: t("duration.m"),
    lessThanMinute: t("duration.lessThanMinute"),
  };
}

export function pendingWhen(c: PendingChange, now: number, t: TFn, locale: Locale): string {
  if (c.keyType === "trusted" || !c.effectiveAt) return t("pending.trusted");
  const left = new Date(c.effectiveAt).getTime() - now;
  if (left <= 0) return t("pending.delaySoon");
  return `${t("pending.effective", { time: formatDateTime(c.effectiveAt, locale) })}, ${t("pending.left", {
    left: formatDuration(left, durationWords(t)),
  })}`;
}

async function fetchPending(pid: string): Promise<PendingChange[]> {
  const r = await unwrap<{ changes: PendingChange[] }>(client.GET("/phones/{pid}/changes", { params: { path: { pid } } }));
  return r.changes;
}

export function PhoneProvider({ pid, children }: { pid: string; children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const phoneRes = useLoad(() => unwrap<Phone>(client.GET("/phones/{pid}", { params: { path: { pid } } })), [pid]);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const [banner, setBanner] = useState<PendingChange | null>(null);

  const reloadPending = useCallback(async () => {
    try {
      setPending(await fetchPending(pid));
    } catch {
      // the overview shows its own error; banners keep working without the list
    }
  }, [pid]);

  const setApps = useCallback((apps: App[]) => setLabels(new Map(apps.map((a) => [a.packageName, a.label]))), []);

  useEffect(() => {
    let alive = true;
    fetchPending(pid)
      .then((list) => alive && setPending(list))
      .catch(() => undefined); // the overview shows its own error
    unwrap<{ apps: App[] }>(client.GET("/phones/{pid}/apps", { params: { path: { pid } } }))
      .then((r) => alive && setApps(r.apps))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pid, setApps]);

  // Moving to another screen clears the notes of the last one.
  const [shownAt, setShownAt] = useState(pathname);
  if (shownAt !== pathname) {
    setShownAt(pathname);
    setNotice(null);
    setBanner(null);
  }

  // Success notes fade after a while; errors and waiting banners stay until dismissed.
  useEffect(() => {
    if (notice?.tone !== "success") return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const run = useCallback<PhoneCtx["run"]>(
    async (fn, appliedText) => {
      Keyboard.dismiss();
      setNotice(null);
      try {
        const r = await fn();
        if (r.status === "applied") {
          setBanner(null);
          setNotice({ tone: "success", text: appliedText ?? t("pending.applied") });
        } else {
          setBanner(r.change);
          await reloadPending();
        }
        return r;
      } catch (err) {
        if (err instanceof ApiError && err.status === 400 && err.issues.length) throw err;
        setNotice({ tone: "error", text: err instanceof ApiError && err.status === 400 ? err.message : errorMessage(err, t) });
        return null;
      }
    },
    [reloadPending, t],
  );

  const appLabel = useCallback((pkg: string) => labels.get(pkg) ?? pkg, [labels]);

  const { data: phone, error, reload: reloadPhoneRes, setData } = phoneRes;
  const setPhone = useCallback((p: Phone) => setData(() => p), [setData]);
  const reloadPhone = useCallback(() => reloadPhoneRes(), [reloadPhoneRes]);

  const value = useMemo<Held>(
    () => ({ phone: phone ?? null, error, setPhone, reloadPhone, pending, reloadPending, appLabel, setApps, run, notify: setNotice }),
    [phone, error, setPhone, reloadPhone, pending, reloadPending, appLabel, setApps, run],
  );

  const c = useColors();
  return (
    <Ctx.Provider value={value}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flex: 1 }}>{children}</View>
        <ChangeBar
          banner={banner}
          notice={notice}
          onDismiss={() => {
            setNotice(null);
            setBanner(null);
          }}
          onCancelled={() => {
            setBanner(null);
            setNotice({ tone: "success", text: t("pending.cancelled") });
            void reloadPending();
          }}
          onError={(text) => setNotice({ tone: "error", text })}
          appLabel={appLabel}
        />
      </View>
    </Ctx.Provider>
  );
}

/** Shows a spinner or the load error until the phone is there, then the screen. */
export function PhoneGate({ children }: { children: ReactNode }) {
  const { phone, error, reloadPhone } = useHeld();
  if (phone) return <>{children}</>;
  return <Screen>{error ? <ErrorState error={error} onRetry={() => void reloadPhone()} /> : <Loading />}</Screen>;
}

/** A calm bar at the bottom of the screen: results of changes and the waiting banner. */
function ChangeBar({
  banner,
  notice,
  onDismiss,
  onCancelled,
  onError,
  appLabel,
}: {
  banner: PendingChange | null;
  notice: NoticeValue | null;
  onDismiss: () => void;
  onCancelled: () => void;
  onError: (text: string) => void;
  appLabel: (pkg: string) => string;
}) {
  const { t, locale } = useI18n();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);

  let text: string | null = null;
  if (banner) {
    const what = describeOp(banner.op, t, locale, appLabel);
    let when: string;
    if (banner.keyType === "trusted" || !banner.effectiveAt) when = t("pending.trustedBanner");
    else {
      const left = new Date(banner.effectiveAt).getTime() - now;
      when =
        left <= 0
          ? t("pending.delaySoon")
          : t("pending.delayBanner", {
              time: formatDateTime(banner.effectiveAt, locale),
              left: formatDuration(left, durationWords(t)),
            });
    }
    text = `${what}. ${when}`;
  }

  // Read the banner out once when it appears; the countdown in it is not re-announced.
  const bannerId = banner?.id;
  const announced = text;
  useEffect(() => {
    if (bannerId && announced) AccessibilityInfo.announceForAccessibility(announced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannerId]);

  async function cancel() {
    if (!banner) return;
    setBusy(true);
    try {
      await unwrap(client.POST("/changes/{cid}/cancel", { params: { path: { cid: banner.id } } }));
      onCancelled();
    } catch (err) {
      onError(err instanceof ApiError && err.status === 409 ? t("pending.gone") : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!banner && !notice) return null;
  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        paddingBottom: space.md + insets.bottom,
        gap: space.sm,
        backgroundColor: c.bg,
      }}
    >
      {banner && text ? (
        <View
          testID="pending-banner"
          style={{ backgroundColor: c.warnBg, borderRadius: radius, paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }}
        >
          <Text>{text}</Text>
          <Row gap={0} style={{ marginLeft: -space.md }}>
            <Button kind="plain" title={t("pending.cancel")} onPress={() => void cancel()} busy={busy} />
            <Button kind="plain" title={t("app.close")} onPress={onDismiss} />
          </Row>
        </View>
      ) : (
        <LiveStatus notice={notice} onClose={onDismiss} />
      )}
    </View>
  );
}
