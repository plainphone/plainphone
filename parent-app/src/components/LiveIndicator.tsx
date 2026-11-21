// SPDX-License-Identifier: Apache-2.0
import { View } from "react-native";
import { useI18n } from "../i18n/I18n";
import { useLiveStatus } from "../lib/live";
import { space, useColors } from "../lib/theme";
import { Text } from "./ui";

/** A dot and a word: live, connecting, or refreshing now and then. Hidden while live updates are off or paused. */
export function LiveIndicator() {
  const { t } = useI18n();
  const c = useColors();
  const status = useLiveStatus();
  if (status === "off") return null;
  const word = t(status === "live" ? "live.on" : status === "connecting" ? "live.connecting" : "native.liveFallback");
  return (
    <View
      testID="live-indicator"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${t("live.title")}: ${word}`}
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
    >
      {/* The word carries the meaning; the dot only repeats it, so it is not colour alone. */}
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: status === "live" ? c.brand : "transparent",
          borderWidth: 2,
          borderColor: status === "live" ? c.brandEdge : c.muted,
        }}
      />
      <Text variant="small">{word}</Text>
    </View>
  );
}
