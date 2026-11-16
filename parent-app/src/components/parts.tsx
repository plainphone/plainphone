// SPDX-License-Identifier: Apache-2.0
//
// Smaller building blocks the phone screens share, on top of ui.tsx: list rows with
// actions, status tags, toggle chips and checkbox rows, and a disclosure.
// Same rules as ui.tsx: 48 dp targets, a role and a label on every control, colours
// from useColors().
import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { type Colors, radius, space, touch, useColors } from "../lib/theme";
import { Text } from "./ui";

/** A short status such as "Waiting" or "Child". */
export function Tag({ text, tone = "plain" }: { text: string; tone?: "plain" | "waiting" }) {
  const c = useColors();
  const waiting = tone === "waiting";
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: waiting ? c.warnBg : c.tint,
        borderColor: waiting ? c.warnLine : c.line,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
      }}
    >
      <Text variant="small" style={{ color: c.ink }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * A row in a list of things you can act on: a contact, a website, a schedule.
 * The text sits on the left; actions (Buttons) wrap below it on narrow screens.
 */
export function ItemRow({
  title,
  meta,
  mono,
  tag,
  waiting,
  children,
  testID,
}: {
  title: string;
  meta?: string;
  /** Show the meta line in the monospace face, for numbers. */
  mono?: boolean;
  tag?: string;
  /** Draws the row dashed: the change behind it is still waiting. */
  waiting?: boolean;
  children?: ReactNode;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View
      testID={testID}
      style={[
        styles.item,
        { backgroundColor: c.surface, borderColor: waiting ? c.warnLine : c.line, borderStyle: waiting ? "dashed" : "solid" },
      ]}
    >
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 160, gap: 2 }}>
        <Text variant="label">{title}</Text>
        {meta ? <Text variant={mono ? "mono" : "small"} style={mono ? { fontSize: 16, color: c.muted } : undefined}>{meta}</Text> : null}
        {tag ? <Tag text={tag} tone={waiting ? "waiting" : "plain"} /> : null}
      </View>
      {children}
    </View>
  );
}

function chipColors(c: Colors, checked: boolean) {
  return { borderColor: checked ? c.accent : c.borderStrong, backgroundColor: checked ? c.tint : c.surface };
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
      <Text variant="label" style={{ color: checked ? c.accent : c.ink }}>
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
  return (
    <Pressable
      testID={testID}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={styles.checkRow}
    >
      <View style={[styles.box, { borderColor: checked ? c.accent : c.borderStrong, backgroundColor: checked ? c.accent : c.surface }]}>
        {checked ? <Text style={{ color: c.onAccent, fontSize: 16, lineHeight: 18, fontWeight: "700" }} importantForAccessibility="no">✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
      </View>
    </Pressable>
  );
}

/** A heading that opens and closes the content below it. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        style={[styles.disclosure, { borderColor: c.line }]}
      >
        <Text variant="label" style={{ flex: 1 }}>
          {title}
        </Text>
        <Text style={{ color: c.muted, fontSize: 18 }} importantForAccessibility="no">
          {open ? "−" : "+"}
        </Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    padding: space.md,
    borderRadius: radius,
    borderWidth: 1,
  },
  chip: {
    minWidth: touch,
    minHeight: touch,
    paddingHorizontal: space.md,
    borderRadius: radius,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkRow: { minHeight: touch, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.xs },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  disclosure: {
    minHeight: touch,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
});
