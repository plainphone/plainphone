// SPDX-License-Identifier: Apache-2.0
//
// The app's building blocks. Rules for every screen:
// - text scales with the system font size (no maxFontSizeMultiplier below 2),
// - every control is at least 48 dp tall and has a role and a label,
// - async results are announced to screen readers (LiveStatus),
// - colours come from useColors(), so light and dark both work.
import {
  Children,
  type DependencyList,
  Fragment,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
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
import { type Colors, gutter, radius, radiusGroup, space, touch, useColors } from "../lib/theme";
import { Icon, type IconName } from "./Icon";

/** Turns any error into a sentence for the user. */
export function errorMessage(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("error.network");
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
  const alive = useRef(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (alive.current) {
        setDataState(d);
        setError(null);
      }
    } catch (err) {
      if (alive.current) setError(err);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    // Loading data is what this effect is for; the spinner state is part of it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const setData = useCallback((f: (d: D | undefined) => D | undefined) => setDataState(f), []);
  return { data, error, loading, reload, setData };
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

// --- Text ---------------------------------------------------------------------

type Variant = "body" | "muted" | "small" | "title" | "heading" | "label" | "row" | "mono" | "error";

export function Text({ variant = "body", style, ...rest }: TextProps & { variant?: Variant }) {
  const c = useColors();
  const s = textStyles(c)[variant];
  const role = variant === "title" || variant === "heading" ? "header" : rest.accessibilityRole;
  // Long Danish words in a large title at a large text size: break them with a hyphen on Android.
  const hyphens = variant === "title" ? { android_hyphenationFrequency: "normal" as const } : null;
  return <RNText {...rest} {...hyphens} accessibilityRole={role} maxFontSizeMultiplier={3} style={[s, style]} />;
}

// One calm scale: 32 page titles, 18 sections, 16 body and rows, 14 notes.
function textStyles(c: Colors) {
  return {
    body: { color: c.ink, fontSize: 16, lineHeight: 24 },
    muted: { color: c.muted, fontSize: 16, lineHeight: 24 },
    small: { color: c.muted, fontSize: 14, lineHeight: 20 },
    title: { color: c.ink, fontSize: 32, lineHeight: 38, fontWeight: "700" as const, letterSpacing: -0.4 },
    heading: { color: c.ink, fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
    label: { color: c.ink, fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
    row: { color: c.ink, fontSize: 16, lineHeight: 22, fontWeight: "500" as const },
    mono: { color: c.ink, fontSize: 18, lineHeight: 26, fontFamily: "monospace", letterSpacing: 1 },
    error: { color: c.danger, fontSize: 14, lineHeight: 20 },
  };
}

/** Press feedback that feels native: a ripple on Android, a soft highlight on iOS. */
export function usePressFeedback() {
  const c = useColors();
  return {
    android_ripple: Platform.OS === "android" ? { color: c.ripple } : undefined,
    pressedBg: (pressed: boolean, base: string) => (pressed && Platform.OS !== "android" ? c.pressed : base),
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
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} colors={[c.accent]} /> : undefined}
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

/** A plain surface for a small form or a block of text. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surface, borderRadius: radiusGroup, padding: space.lg, gap: space.md }, style]}>{children}</View>;
}

/**
 * Rows grouped on one surface with hairlines between them (an inset grouped list).
 * Rows bring their own padding so their press feedback reaches the edges.
 */
export function List({ children, testID }: { children: ReactNode; testID?: string }) {
  const c = useColors();
  const rows = Children.toArray(children).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <View testID={testID} style={{ backgroundColor: c.surface, borderRadius: radiusGroup, overflow: "hidden" }}>
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: space.lg }} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** A titled part of a screen: a short heading, an optional note, then its content. */
export function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: 2, paddingHorizontal: space.xs }}>
        <Text variant="heading">{title}</Text>
        {help ? <Text variant="small">{help}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <View style={{ gap: space.sm, paddingHorizontal: space.xs }}>
      <Text variant="title">{children}</Text>
      {sub ? <Text variant="muted">{sub}</Text> : null}
    </View>
  );
}

// --- Controls -----------------------------------------------------------------

/**
 * primary: the one main action on a screen. secondary: a quieter tinted button.
 * danger: confirms something destructive. plain: a text button. destructive: a red text button.
 */
type ButtonKind = "primary" | "secondary" | "danger" | "plain" | "destructive";

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  busy,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  /** When the spoken name needs more than the visible title, e.g. "Remove Anna" for "Remove". */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}) {
  const c = useColors();
  const feedback = usePressFeedback();
  const bg = kind === "primary" ? c.accent : kind === "danger" ? c.danger : kind === "secondary" ? c.tint : "transparent";
  const fg =
    kind === "primary" ? c.onAccent : kind === "danger" ? c.onDanger : kind === "destructive" ? c.danger : c.accent;
  const text = kind === "plain" || kind === "destructive";
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      android_ripple={feedback.android_ripple}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: text ? feedback.pressedBg(pressed, "transparent") : bg, opacity: off ? 0.55 : pressed && !text && Platform.OS !== "android" ? 0.85 : 1 },
        kind === "primary" || kind === "danger" ? styles.buttonSolid : null,
        text && { paddingHorizontal: space.md, alignSelf: "flex-start" },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} style={{ marginRight: space.sm }} /> : null}
      <RNText maxFontSizeMultiplier={3} style={{ color: fg, fontSize: 16, lineHeight: 22, fontWeight: "600", textAlign: "center" }}>
        {title}
      </RNText>
    </Pressable>
  );
}

/** A round icon button for a header, e.g. settings. */
export function IconButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  const feedback = usePressFeedback();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={Platform.OS === "android" ? { color: c.ripple, borderless: true, radius: touch / 2 } : undefined}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: feedback.pressedBg(pressed, "transparent") }]}
    >
      <Icon name={icon} size={24} color={c.accent} />
    </Pressable>
  );
}

/** A tappable list row, e.g. a phone or a section of a phone. Put it in a <List>. */
export function LinkRow({
  title,
  meta,
  badge,
  leading,
  tone = "default",
  onPress,
  testID,
}: {
  title: string;
  meta?: string;
  badge?: string;
  /** Something small before the text: an initial or an icon. */
  leading?: ReactNode;
  /** accent: an action row ("Add phone"), drawn in the accent colour and without the chevron. */
  tone?: "default" | "accent";
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  const feedback = usePressFeedback();
  const label = [title, meta, badge].filter(Boolean).join(". ");
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={feedback.android_ripple}
      style={({ pressed }) => [styles.linkRow, { backgroundColor: feedback.pressedBg(pressed, c.surface) }]}
    >
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="row" style={tone === "accent" ? { color: c.accent, fontWeight: "600" } : undefined}>
          {title}
        </Text>
        {meta ? <Text variant="small">{meta}</Text> : null}
        {badge ? <Badge text={badge} /> : null}
      </View>
      {tone === "default" ? <Icon name="chevron" size={18} color={c.muted} /> : null}
    </Pressable>
  );
}

/** A small "waiting" marker, e.g. "2 changes waiting". */
export function Badge({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.warnLine, marginTop: 6 }} />
      <Text variant="small" style={{ color: c.ink, fontWeight: "600" }}>
        {text}
      </Text>
    </View>
  );
}

export function Field({
  label,
  help,
  error,
  onFocus,
  onBlur,
  ...input
}: TextInputProps & { label: string; help?: string; error?: string }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const off = input.editable === false;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" nativeID={undefined} style={styles.fieldText}>
        {label}
      </Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityHint={[help, error].filter(Boolean).join(". ") || undefined}
        placeholderTextColor={c.muted}
        maxFontSizeMultiplier={3}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            color: off ? c.muted : c.ink,
            backgroundColor: off ? c.bg : c.surface,
            borderColor: error ? c.danger : focused ? c.accent : c.borderStrong,
            borderWidth: focused || error ? 2 : 1,
            paddingHorizontal: focused || error ? space.md + 1 : space.md + 2,
          },
          input.style,
        ]}
      />
      {help ? (
        <Text variant="small" style={styles.fieldText}>
          {help}
        </Text>
      ) : null}
      {error ? (
        <Text variant="error" accessibilityLiveRegion="polite" style={styles.fieldText}>
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
  flush,
  testID,
}: {
  label: string;
  help?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  /** Inside a Card (which has its own padding) rather than as a row of a List. */
  flush?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const feedback = usePressFeedback();
  return (
    <Pressable
      testID={testID}
      onPress={() => !disabled && onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={help}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      android_ripple={disabled ? undefined : feedback.android_ripple}
      style={({ pressed }) => [
        styles.switchRow,
        flush ? { paddingHorizontal: 0 } : { backgroundColor: feedback.pressedBg(pressed && !disabled, c.surface) },
        { opacity: disabled ? 0.6 : 1 },
      ]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="row">{label}</Text>
        {help ? <Text variant="small">{help}</Text> : null}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ true: c.accent, false: c.borderStrong }}
        thumbColor={Platform.OS === "ios" ? undefined : value ? c.onAccent : c.surface}
        {...(Platform.OS === "web" ? { activeThumbColor: c.onAccent } : null)}
        ios_backgroundColor={c.borderStrong}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

/** Choose one of a few options: radio rows in a grouped list. */
export function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
  asSection,
}: {
  label: string;
  value: V;
  options: { value: V; label: string; help?: string }[];
  onChange: (v: V) => void;
  /** The choice is a part of the screen on its own: its label is drawn as a section heading. */
  asSection?: boolean;
}) {
  const c = useColors();
  const feedback = usePressFeedback();
  return (
    <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant={asSection ? "heading" : "label"} style={{ paddingHorizontal: space.xs }}>
        {label}
      </Text>
      <List>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityLabel={o.help ? `${o.label}. ${o.help}` : o.label}
              accessibilityState={{ checked: on }}
              android_ripple={feedback.android_ripple}
              style={({ pressed }) => [
                styles.choice,
                // With a help line the radio sits by the label; on its own it centres in the row.
                { alignItems: o.help ? "flex-start" : "center", backgroundColor: feedback.pressedBg(pressed, c.surface) },
              ]}
            >
              <View style={[styles.radio, { borderColor: on ? c.accent : c.borderStrong }]}>
                {on ? <View style={[styles.radioDot, { backgroundColor: c.accent }]} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="row">{o.label}</Text>
                {o.help ? <Text variant="small">{o.help}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </List>
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
      {onRetry ? <Button kind="plain" title={t("app.retry")} onPress={onRetry} /> : null}
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
  const dot = tone === "error" ? c.danger : tone === "warn" ? c.warnLine : c.accent;
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
      style={{ backgroundColor: bg, borderRadius: radius, paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }}
    >
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot, marginTop: 8 }} />
        <Text style={{ flex: 1 }}>{text}</Text>
      </View>
      {children ? <View style={{ paddingLeft: space.lg + 4, gap: space.sm }}>{children}</View> : null}
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
  screen: { flexGrow: 1, paddingHorizontal: gutter, paddingTop: space.sm, paddingBottom: space.xxl + space.lg },
  inner: { width: "100%", maxWidth: 640, alignSelf: "center", gap: space.xl + space.xs },
  button: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSolid: { minHeight: 52 },
  iconButton: { width: touch, height: touch, borderRadius: touch / 2, alignItems: "center", justifyContent: "center" },
  linkRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  input: { minHeight: 50, borderRadius: radius, fontSize: 16 },
  switchRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  choice: { minHeight: 56, flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md + 2 },
  fieldText: { paddingHorizontal: space.xs },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  state: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingVertical: space.xl },
});
