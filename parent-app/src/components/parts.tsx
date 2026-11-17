// SPDX-License-Identifier: Apache-2.0
//
// Smaller building blocks the phone screens share, on top of ui.tsx: list rows with
// actions, status tags, toggle chips and checkbox rows (both rows for a <List>), and a disclosure.
// Same rules as ui.tsx: 48 dp targets, a role and a label on every control, colours
// from useColors().
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { type Colors, radius, space, touch, useColors } from "../lib/theme";
import { Icon } from "./Icon";
import { Text, usePressFeedback } from "./ui";

/** A short status such as "Waiting" or "Child". */
export function Tag({ text, tone = "plain" }: { text: string; tone?: "plain" | "waiting" }) {
  const c = useColors();
  const waiting = tone === "waiting";
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: waiting ? c.warnBg : c.tint,
        borderRadius: 999,
        paddingHorizontal: space.sm + 2,
        paddingVertical: 2,
        marginTop: 4,
      }}
    >
      <Text variant="small" style={{ color: c.ink, fontWeight: "600" }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * A row in a list of things you can act on: a contact, a website, a schedule. Put it in a <List>.
 * The text sits on the left; quiet actions (plain Buttons) sit on the right and wrap below
 * the text when it is large.
 */
export function ItemRow({
  title,
  meta,
  mono,
  tag,
  waiting,
  stacked,
  children,
  testID,
}: {
  title: string;
  meta?: string;
  /** Show the meta line in the monospace face, for numbers. */
  mono?: boolean;
  tag?: string;
  /** The change behind the row is still waiting: the tag is drawn as a waiting marker. */
  waiting?: boolean;
  /** Actions always go below the text, lined up with it (for long texts such as waiting changes). */
  stacked?: boolean;
  children?: ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={[styles.item, { backgroundColor: c.surface }]}
    >
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: stacked ? "100%" : 160, gap: 2 }}>
        <Text variant="row">{title}</Text>
        {meta ? <Text variant={mono ? "mono" : "small"} style={mono ? { fontSize: 16, color: c.muted } : undefined}>{meta}</Text> : null}
        {tag ? <Tag text={tag} tone={waiting ? "waiting" : "plain"} /> : null}
      </View>
      {stacked && children ? <View style={styles.stackedActions}>{children}</View> : children}
    </View>
  );
}

function chipColors(c: Colors, checked: boolean) {
  return { borderColor: checked ? c.accent : c.borderStrong, backgroundColor: checked ? c.accent : c.surface };
}

/** A toggle chip, e.g. a weekday. Announced as a checkbox. */
export function Chip({
  label,
  accessibilityLabel,
  checked,
  onPress,
  testID,
}: {
  label: string;
  /** The full spoken name when the visible label is short, e.g. "Monday" for "Mon". */
  accessibilityLabel?: string;
  checked: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked }}
      style={[styles.chip, chipColors(c, checked)]}
    >
      <Text variant="label" style={{ color: checked ? c.onAccent : c.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A full-width checkbox row, for picking several things from a list. */
export function CheckRow({
  label,
  checked,
  onToggle,
  testID,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  const c = useColors();
  const feedback = usePressFeedback();
  return (
    <Pressable
      testID={testID}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      android_ripple={feedback.android_ripple}
      style={({ pressed }) => [styles.checkRow, { backgroundColor: feedback.pressedBg(pressed, c.surface) }]}
    >
      <View style={[styles.box, { borderColor: checked ? c.accent : c.borderStrong, backgroundColor: checked ? c.accent : c.surface }]}>
        {checked ? <Icon name="check" size={16} strokeWidth={3} color={c.onAccent} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="row">{label}</Text>
      </View>
    </Pressable>
  );
}

/** A quiet line that opens and closes the content below it. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors();
  const feedback = usePressFeedback();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        android_ripple={feedback.android_ripple}
        style={({ pressed }) => [styles.disclosure, { backgroundColor: feedback.pressedBg(pressed, "transparent") }]}
      >
        <Text variant="row" style={{ flex: 1, color: c.muted }}>
          {title}
        </Text>
        <View style={{ transform: [{ rotate: open ? "-90deg" : "90deg" }] }}>
          <Icon name="chevron" size={18} color={c.muted} />
        </View>
      </Pressable>
      {open ? <View style={{ gap: space.sm, paddingHorizontal: space.xs }}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    minHeight: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: space.md,
    rowGap: space.xs,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
  },
  // Text buttons carry their own padding; pull them left so their text lines up with the row's.
  stackedActions: { flexBasis: "100%", flexDirection: "row", flexWrap: "wrap", marginLeft: -space.md, marginTop: -space.xs },
  chip: {
    minWidth: touch,
    minHeight: touch,
    paddingHorizontal: space.md,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  checkRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  disclosure: {
    minHeight: touch,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius,
  },
});
