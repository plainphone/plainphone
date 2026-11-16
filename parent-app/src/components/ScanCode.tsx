// SPDX-License-Identifier: Apache-2.0
//
// "Scan the code": opens the camera, reads the QR code the child's phone shows and hands
// back the eight-character pairing code. The camera is only asked for when the button is
// pressed, and nothing is recorded or sent anywhere. Phones only; the web build hides it.
import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useI18n } from "../i18n/I18n";
import { codeFromScan } from "../lib/links";
import { radius, space, useColors } from "../lib/theme";
import { Button, type NoticeValue, Stack, Text } from "./ui";

export function ScanCode({
  onCode,
  onStatus,
}: {
  /** Called once with the 8-character code from a valid Plainphone QR code. */
  onCode: (code: string) => void;
  /** Reports what went wrong (denied camera, wrong QR code); null clears it. */
  onStatus: (n: NoticeValue | null) => void;
}) {
  const { t } = useI18n();
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  // The camera reports the same QR code many times a second; say "wrong code" once.
  const lastWrong = useRef<string | null>(null);

  async function start() {
    onStatus(null);
    const p = permission?.granted ? permission : await requestPermission();
    if (!p.granted) {
      onStatus({ tone: "error", text: t("native.scanDenied") });
      return;
    }
    lastWrong.current = null;
    setActive(true);
  }

  function handle({ data }: BarcodeScanningResult) {
    const code = codeFromScan(data);
    if (!code) {
      if (lastWrong.current !== data) {
        lastWrong.current = data;
        onStatus({ tone: "error", text: t("native.scanWrong") });
      }
      return;
    }
    setActive(false);
    onCode(code);
  }

  if (!active) return <Button kind="secondary" title={t("native.scan")} onPress={() => void start()} testID="scan-start" />;
  return (
    <Stack>
      <Text variant="muted">{t("native.scanHelp")}</Text>
      <View style={[styles.camera, { backgroundColor: c.surface }]} testID="scan-camera">
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handle}
        />
      </View>
      <Button kind="secondary" title={t("native.scanStop")} onPress={() => setActive(false)} testID="scan-stop" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  camera: { height: 280, borderRadius: radius, overflow: "hidden", marginBottom: space.xs },
});
