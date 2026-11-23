// SPDX-License-Identifier: Apache-2.0
//
// The app's building blocks. Rules for every screen:
// - text scales with the system font size (no maxFontSizeMultiplier below 2),
// - every control is at least 48 dp tall and has a role and a label,
// - async results are announced to screen readers (LiveStatus),
// - colours come from useColors(), so light and dark both work.
import {
  type DependencyList,
  type ComponentRef,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch as RNSwitch,
  Text as RNText,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "../api/client";
import { type TFn, useI18n } from "../i18n/I18n";
import { planLimitKey, planLimitOf } from "@plainphone/shared/billing";
import { type Colors, fonts, radius, radiusControl, radiusPill, space, touch, useColors } from "../lib/theme";

/** Turns any error into a sentence for the user. */
export function errorMessage(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("error.network");
    // Adding beyond the free plan (docs/billing.md). Explained, never sold: no store build links to a payment.
    const limit = planLimitOf(err.status, err.data);
    if (limit) return t(planLimitKey(limit), { max: limit.max });
    // Today's new households are taken on the hosted service (SIGNUP_DAILY_CAP).
    if (err.data.code === "signup_cap_reached") return `${t("signupCap.body")} ${t("signupCap.selfHost")}`;
    // The server's mail cap, or a busy mail server (MAIL_HOURLY_CAP, MAIL_DAILY_CAP; docs/operations.md).
    if (err.data.code === "mail_unavailable") return t("mailUnavailable.error");
    // Bot and spam protection (docs/operations.md, "Bot and spam protection").
    if (err.data.code === "invite_cap_reached") return t("inviteCap.error");
    if (err.data.code === "household_phone_cap") return t("phoneCap.error", { max: Number(err.data.max) || 0 });
    if (err.data.code === "disposable_email") return t("disposableEmail.error");
    if (err.status === 429) return t("error.tooMany");
    if (err.status === 404) return t("error.notFound");
    if (err.status === 400 && err.issues.length) return t("error.form");
  }
  return t("error.generic");
}

export interface Loaded<D> {
  data: D | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  /** Like reload, but without the loading flag, so a live refresh does not flash the pull-to-refresh spinner. */
  reloadQuiet: () => Promise<void>;
  setData: (fn: (d: D | undefined) => D | undefined) => void;
}

/** Loads data on mount and when deps change. Keeps old data while reloading. */
export function useLoad<D>(fn: () => Promise<D>, deps: DependencyList): Loaded<D> {
  const [data, setDataState] = useState<D | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  // Only the newest request may set the state. An older one (for the previous phone, or a poll
  // that started before a change) can finish last and would show stale data.
  const latest = useRef(0);
  // A quiet load (a live update) does not show the spinner.
  const load = useCallback(async (quiet: boolean) => {
    const id = ++latest.current;
    if (!quiet) setLoading(true);
    try {
      const d = await fnRef.current();
      if (latest.current === id) {
        setDataState(d);
        setError(null);
      }
    } catch (err) {
      if (latest.current === id) setError(err);
    } finally {
      if (latest.current === id) setLoading(false);
    }
  }, []);
  const reload = useCallback(() => load(false), [load]);
  const reloadQuiet = useCallback(() => load(true), [load]);
  useEffect(() => {
    // Loading data is what this effect is for; the spinner state is part of it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => {
      // A counter, not a DOM node: bumping it makes the answers to these deps stale.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      latest.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const setData = useCallback((f: (d: D | undefined) => D | undefined) => setDataState(f), []);
  return { data, error, loading, reload, reloadQuiet, setData };
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Runs an action only when the previous run has finished. A `busy` state alone is not enough:
 * two taps inside one frame both fire before the re-render disables the button.
 */
export function useSingleFlight() {
  const flying = useRef(false);
  return useCallback(async (action: () => Promise<void>) => {
    if (flying.current) return;
    flying.current = true;
    try {
      await action();
    } finally {
      flying.current = false;
    }
  }, []);
}

// --- Text ---------------------------------------------------------------------

type Variant = "body" | "muted" | "small" | "title" | "heading" | "label" | "mono" | "error";

export function Text({ variant = "body", style, ...rest }: TextProps & { variant?: Variant }) {
  const c = useColors();
  const s = textStyles(c)[variant];
  const role = variant === "title" || variant === "heading" ? "header" : rest.accessibilityRole;
  return <RNText {...rest} accessibilityRole={role} maxFontSizeMultiplier={3} style={[s, style]} />;
}

function textStyles(c: Colors) {
  return {
    body: { color: c.ink, fontFamily: fonts.text, fontSize: 16, lineHeight: 24 },
    muted: { color: c.muted, fontFamily: fonts.text, fontSize: 16, lineHeight: 24 },
    small: { color: c.muted, fontFamily: fonts.text, fontSize: 14, lineHeight: 20 },
    title: { color: c.ink, fontFamily: fonts.text, fontSize: 28, lineHeight: 34, fontWeight: "700" as const },
    heading: { color: c.ink, fontFamily: fonts.text, fontSize: 20, lineHeight: 28, fontWeight: "700" as const },
    label: { color: c.ink, fontFamily: fonts.text, fontSize: 16, lineHeight: 22, fontWeight: "700" as const },
    mono: { color: c.ink, fontSize: 18, lineHeight: 26, fontFamily: fonts.mono, letterSpacing: 1 },
    error: { color: c.danger, fontFamily: fonts.text, fontSize: 14, lineHeight: 20 },
  };
}

// --- Layout -------------------------------------------------------------------

/** A scrolling screen with safe-area padding and optional pull-to-refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  testID,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        testID={testID}
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined}
      >
        <View style={styles.inner}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function Stack({ gap = space.md, children, style }: { gap?: number; children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Row({ gap = space.sm, children, style }: { gap?: number; children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap }, style]}>{children}</View>;
}

export function Card({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={[{ backgroundColor: c.surface, borderRadius: radius, borderWidth: 1, borderColor: c.line, padding: space.lg, gap: space.md }, style]}>
      {children}
    </View>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ gap: space.xs, marginBottom: space.sm }}>
      <Text variant="title">{children}</Text>
      {sub ? <Text variant="muted">{sub}</Text> : null}
    </View>
  );
}

// --- Controls -----------------------------------------------------------------

type ButtonKind = "primary" | "secondary" | "danger" | "plain";

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  accessibilityLabel,
  accessibilityHint,
  testID,
  ref,
}: {
  title: string;
  onPress: () => void;
  /** For moving screen-reader focus to the button, e.g. after a confirmation closes. */
  ref?: Ref<ComponentRef<typeof View>>;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  /** When the spoken name needs more than the visible title, e.g. "Remove Anna" for "Remove". */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  const c = useColors();
  const bg = kind === "primary" ? c.accent : kind === "danger" ? c.danger : "transparent";
  const fg = kind === "primary" ? c.onAccent : kind === "danger" ? c.onDanger : c.accent;
  const off = disabled || busy;
  return (
    <Pressable
      ref={ref}
      testID={testID}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: kind === "secondary" ? c.borderStrong : bg,
          opacity: off ? 0.6 : pressed ? 0.85 : 1,
        },
        kind === "plain" && { paddingHorizontal: space.sm, alignSelf: "flex-start" },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} style={{ marginRight: space.sm }} /> : null}
      <RNText maxFontSizeMultiplier={3} style={{ color: fg, fontFamily: fonts.text, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
        {title}
      </RNText>
    </Pressable>
  );
}

/** A tappable list row, e.g. a phone or a section of a phone. */
export function LinkRow({
  title,
  meta,
  note,
  badge,
  onPress,
  testID,
}: {
  title: string;
  meta?: string;
  /** A second line under meta, e.g. what an iPhone cannot do. */
  note?: string;
  badge?: string;
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  const label = [title, meta, note, badge].filter(Boolean).join(". ");
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.linkRow,
        { backgroundColor: pressed ? c.tint : c.surface, borderColor: c.line },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label">{title}</Text>
        {meta ? <Text variant="small">{meta}</Text> : null}
        {note ? <Text variant="small">{note}</Text> : null}
        {badge ? <Text style={{ color: c.accent, fontWeight: "700" }}>{badge}</Text> : null}
      </View>
      <RNText style={{ color: c.muted, fontSize: 22 }} importantForAccessibility="no" accessibilityElementsHidden>
        ›
      </RNText>
    </Pressable>
  );
}

export function Field({
  label,
  help,
  error,
  ...input
}: TextInputProps & { label: string; help?: string; error?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" nativeID={undefined}>
        {label}
      </Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityHint={[help, error].filter(Boolean).join(". ") || undefined}
        placeholderTextColor={c.muted}
        maxFontSizeMultiplier={3}
        style={[
          styles.input,
          { color: c.ink, backgroundColor: c.surface, borderColor: error ? c.danger : c.borderStrong },
          input.style,
        ]}
      />
      {help ? <Text variant="small">{help}</Text> : null}
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Switch({
  label,
  help,
  value,
  onValueChange,
  disabled,
  testID,
}: {
  label: string;
  help?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={() => !disabled && onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={help}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={[styles.switchRow, { opacity: disabled ? 0.6 : 1 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text>{label}</Text>
        {help ? <Text variant="small">{help}</Text> : null}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: c.brand, false: c.borderStrong }}
        thumbColor={value ? c.onBrand : c.surface}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

/** Choose one of a few options, each with a title and an explaining line (radio buttons). */
export function Choice<V extends string>({
  label,
  hideLabel,
  hint,
  value,
  options,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  /** The label is spoken but not shown, when a heading above already says it. */
  hideLabel?: boolean;
  /** A line under the label that explains the whole choice. */
  hint?: string;
  value: V;
  options: { value: V; label: string; help?: string; testID?: string }[];
  onChange: (v: V) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={{ gap: space.sm, opacity: disabled ? 0.6 : 1 }}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      {hideLabel ? null : <Text variant="label">{label}</Text>}
      {hint ? <Text variant="small">{hint}</Text> : null}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={o.testID}
            onPress={() => !disabled && onChange(o.value)}
            accessibilityRole="radio"
            accessibilityLabel={o.help ? `${o.label}. ${o.help}` : o.label}
            accessibilityState={{ checked: on, disabled: !!disabled }}
            style={[
              styles.choice,
              { borderColor: on ? c.accent : c.borderStrong, backgroundColor: on ? c.tint : c.surface },
            ]}
          >
            <View style={[styles.radio, { borderColor: on ? c.accent : c.borderStrong }]}>
              {on ? <View style={[styles.radioDot, { backgroundColor: c.accent }]} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label">{o.label}</Text>
              {o.help ? <Text variant="small">{o.help}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A row that opens and closes the rarely needed options under it (the PWA's details element). */
export function Disclosure({
  title,
  open,
  onToggle,
  children,
  testID,
}: {
  title: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        testID={testID}
        onPress={() => onToggle(!open)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        style={styles.disclosure}
      >
        <Text variant="label">{title}</Text>
        <RNText style={{ color: c.muted, fontSize: 18 }} importantForAccessibility="no" accessibilityElementsHidden>
          {open ? "▾" : "▸"}
        </RNText>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/** A short row of equal choices, like 5, 10, 15 and 30 minutes (segmented control). */
export function Segmented<V extends string | number>({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: V;
  options: { value: V; label: string; testID?: string }[];
  onChange: (v: V) => void;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View testID={testID} style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="label">{label}</Text>
      <View style={styles.segmented}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              testID={o.testID}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: on }}
              style={[styles.segment, { borderColor: on ? c.accent : c.borderStrong, backgroundColor: on ? c.accent : c.surface }]}
            >
              <RNText maxFontSizeMultiplier={3} style={{ color: on ? c.onAccent : c.ink, fontFamily: fonts.text, fontSize: 16, fontWeight: "700", textAlign: "center" }}>
                {o.label}
              </RNText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// --- States -------------------------------------------------------------------

export function Loading() {
  const { t } = useI18n();
  const c = useColors();
  return (
    <View style={styles.state} accessibilityRole="progressbar" accessibilityLabel={t("app.loading")}>
      <ActivityIndicator color={c.accent} />
      <Text variant="muted">{t("app.loading")}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <Notice tone="error" text={`${t("error.load")} ${errorMessage(error, t)}`}>
      {onRetry ? <Button kind="secondary" title={t("app.retry")} onPress={onRetry} /> : null}
    </Notice>
  );
}

/** Wraps a loaded resource: spinner first, error with retry, then the content. */
export function LoadGate<D>({ res, children }: { res: Loaded<D>; children: (d: D) => ReactNode }) {
  if (res.data === undefined) {
    if (res.error) return <ErrorState error={res.error} onRetry={() => void res.reload()} />;
    return <Loading />;
  }
  return <>{children(res.data)}</>;
}

export type Tone = "info" | "success" | "error" | "warn";
export interface NoticeValue {
  tone: Tone;
  text: string;
}

export function Notice({ tone, text, children }: { tone: Tone; text: string; children?: ReactNode }) {
  const c = useColors();
  const bg = tone === "error" ? c.dangerBg : tone === "warn" ? c.warnBg : c.tint;
  const line = tone === "error" ? c.danger : tone === "warn" ? c.warnLine : c.accent;
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      style={{ backgroundColor: bg, borderLeftWidth: 4, borderLeftColor: line, borderRadius: radius, padding: space.md, gap: space.sm }}
    >
      <Text>{text}</Text>
      {children}
    </View>
  );
}

/**
 * Shows the latest async result and reads it out to screen readers.
 * Android picks it up through the live region, iOS through an announcement.
 */
export function LiveStatus({ notice, onClose }: { notice: NoticeValue | null; onClose?: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice.text);
  }, [notice]);
  if (!notice) return null;
  return (
    <Notice tone={notice.tone} text={notice.text}>
      {onClose ? <Button kind="plain" title={t("app.close")} onPress={onClose} /> : null}
    </Notice>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: space.lg, paddingBottom: space.xxl },
  inner: { width: "100%", maxWidth: 640, alignSelf: "center", gap: space.lg },
  button: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radiusPill,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  linkRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: radius,
    borderWidth: 1,
  },
  input: { minHeight: touch, borderWidth: 1.5, borderRadius: radiusControl, paddingHorizontal: space.md, fontFamily: fonts.text, fontSize: 16 },
  switchRow: { minHeight: touch, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
  choice: { minHeight: touch, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radiusControl, borderWidth: 1.5 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  disclosure: { minHeight: touch, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  segmented: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  segment: { flexGrow: 1, flexBasis: 72, minHeight: touch, paddingHorizontal: space.sm, borderRadius: radiusControl, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  state: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.lg },
});
