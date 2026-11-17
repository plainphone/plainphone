// SPDX-License-Identifier: Apache-2.0
//
// The same calm palette as the PWA (web/src/styles.css) and plainphone.org:
// one green accent, light and dark, AA contrast on every text pair.
import { useColorScheme } from "react-native";

export const light = {
  bg: "#f2f3ef",
  surface: "#ffffff",
  ink: "#1c2321",
  muted: "#4d5753",
  line: "#dfe3df",
  borderStrong: "#7a8580",
  accent: "#24604a",
  onAccent: "#ffffff",
  tint: "#e3efe8",
  warnBg: "#fbf1d9",
  warnLine: "#a57a10",
  danger: "#a3261d",
  onDanger: "#ffffff",
  dangerBg: "#fbe9e7",
  /** Row highlight while pressed (iOS) and the Android ripple. */
  pressed: "#e9ece7",
  ripple: "rgba(36, 96, 74, 0.14)",
};

export type Colors = typeof light;

export const dark: Colors = {
  bg: "#121816",
  surface: "#1b2320",
  ink: "#e8ece9",
  muted: "#a9b3ae",
  line: "#2c3833",
  borderStrong: "#6b7873",
  accent: "#7fc4a2",
  onAccent: "#0d1a14",
  tint: "#22322b",
  warnBg: "#33301f",
  warnLine: "#d6b45a",
  danger: "#f08a80",
  onDanger: "#1b0d0b",
  dangerBg: "#3a2321",
  pressed: "#232d29",
  ripple: "rgba(127, 196, 162, 0.18)",
};

/** Controls (buttons, fields, notices). */
export const radius = 12;
/** Grouped lists and cards: one step rounder than the controls inside them. */
export const radiusGroup = 16;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
/** Horizontal page margin. */
export const gutter = 20;
/** Minimum touch target (Apple 44 pt, Material 48 dp). */
export const touch = 48;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
