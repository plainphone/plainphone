// SPDX-License-Identifier: Apache-2.0
//
// The Plainphone mark: a phone with one calm wave. Same drawing as web/public/icon.svg.
import Svg, { Path, Rect } from "react-native-svg";
import { useColors } from "../lib/theme";

export function Mark({ size = 32 }: { size?: number }) {
  const c = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect width={64} height={64} rx={16} fill={c.accent} />
      <Rect x={19} y={10} width={26} height={44} rx={7} fill="none" stroke={c.onAccent} strokeWidth={4} />
      <Path d="M24.5 33c2.5-2.6 5-2.6 7.5 0s5 2.6 7.5 0" fill="none" stroke={c.onAccent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
