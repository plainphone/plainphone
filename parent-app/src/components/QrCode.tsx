// SPDX-License-Identifier: Apache-2.0
//
// A QR code drawn with react-native-svg, from uqr (the encoder the PWA uses). Always dark on
// white, also in dark mode, because cameras read that best.
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { encode } from "uqr";

export function QrCode({ value, size = 220, label, testID }: { value: string; size?: number; label: string; testID?: string }) {
  const { path, cells } = useMemo(() => {
    const qr = encode(value, { border: 2 });
    let d = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => {
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }));
    return { path: d, cells: qr.size };
  }, [value]);
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ alignSelf: "center" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${cells} ${cells}`}>
        <Rect x={0} y={0} width={cells} height={cells} fill="#ffffff" />
        <Path d={path} fill="#141414" />
      </Svg>
    </View>
  );
}
