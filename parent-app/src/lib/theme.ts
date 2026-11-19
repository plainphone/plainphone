// SPDX-License-Identifier: Apache-2.0
//
// Brand direction C, Switch (docs/brand/README.md), the same palette as the PWA
// (web/src/styles.css) and the phone: graphite and white with one signal green, light and dark,
// AA contrast on every text pair. `brand` only means "on" (switches, the mark, active states),
// always with `onBrand` on it and `brandEdge` around it; never decoration or a call button.
import { Platform, useColorScheme } from "react-native";

export const light = {
  bg: "#f5f5f3",
  surface: "#ffffff",
  ink: "#141414",
  muted: "#525252",
  line: "#e3e3e0",
  borderStrong: "#767676",
  accent: "#141414",
  onAccent: "#ffffff",
  tint: "#eef8cf",
  warnBg: "#fff2c2",
  warnLine: "#a57a10",
  danger: "#b3261e",
  onDanger: "#ffffff",
  dangerBg: "#fde8e6",
  brand: "#c5f04a",
  onBrand: "#141414",
  brandEdge: "#141414",
};

export type Colors = typeof light;

export const dark: Colors = {
  bg: "#0f0f0f",
  surface: "#1b1b1b",
  ink: "#f2f2ef",
  muted: "#b3b3ae",
  line: "#2d2d2b",
  borderStrong: "#7c7c78",
  accent: "#c5f04a",
  onAccent: "#141414",
  tint: "#27301a",
  warnBg: "#393217",
  warnLine: "#d6b45a",
  danger: "#ff8a80",
  onDanger: "#1b0d0b",
  dangerBg: "#3e1f1d",
  brand: "#c5f04a",
  onBrand: "#141414",
  brandEdge: "#c5f04a",
};

/**
 * Schibsted Grotesk 400/700 and IBM Plex Mono 500, built into the app by the expo-font plugin
 * (app.config.ts). Where the font is missing (Expo Go, tests) the system font is used; the web
 * build (development and screenshots) names a system fallback, or the browser would pick a serif.
 */
export const fonts = Platform.select({
  web: { text: "'Schibsted Grotesk', system-ui, sans-serif", mono: "'IBM Plex Mono', ui-monospace, monospace" },
  default: { text: "Schibsted Grotesk", mono: "IBMPlexMono-Medium" },
});

/** Grouped surfaces (cards, rows) and controls use 6; buttons are pills. */
export const radius = 6;
export const radiusControl = 6;
export const radiusPill = 999;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
/** Minimum touch target (Apple 44 pt, Material 48 dp). */
export const touch = 48;

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
