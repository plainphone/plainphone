// SPDX-License-Identifier: Apache-2.0
//
// A shared location in the family inbox thread (docs/extended-family.md): while it is live, the time
// it ends and a plain OpenStreetMap link; after that only the line. Same copy as the dashboard.
import { Linking, View } from "react-native";
import { useI18n } from "../i18n/I18n";
import { coordinateText, type LocationSnapshot, snapshotUntil } from "../shared/lib/extended-family";
import { osmUrl } from "../shared/lib/format";
import { copyText } from "../lib/clipboard";
import { Button, Text } from "./ui";

export function SnapshotLine({ location }: { location: LocationSnapshot | null | undefined }) {
  const { t, locale } = useI18n();
  if (!location) return <Text>{t("ext.snapshotGone")}</Text>;
  return (
    <View style={{ gap: 4 }}>
      <Text>{t("ext.snapshot")} · {t("ext.snapshotUntil", { time: snapshotUntil(location.expiresAt, locale) })}</Text>
      <Button testID="snapshot-map" kind="secondary" title={t("ext.openMap")}
        onPress={() => void Linking.openURL(osmUrl(location.lat, location.lon)).catch(() => undefined)} />
      <Button testID="snapshot-copy" kind="plain" title={t("ext.copyCoords")}
        onPress={() => void copyText(coordinateText(location)).catch(() => undefined)} />
    </View>
  );
}
