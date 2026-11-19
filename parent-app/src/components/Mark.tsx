// SPDX-License-Identifier: Apache-2.0
//
// The Plainphone mark: an upright switch that is also a phone with one round button.
// Same drawing as docs/brand/directions/c/mark.svg (light, ink edge) and mark-dark.svg (dark).
import Svg, { Circle, Rect } from "react-native-svg";
import { useColors } from "../lib/theme";

export function Mark({ size = 32 }: { size?: number }) {
  const c = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={19} y={5} width={26} height={54} rx={13} fill={c.brand} stroke={c.brandEdge} strokeWidth={4} />
      <Circle cx={32} cy={45} r={7.5} fill={c.onBrand} />
    </Svg>
  );
}
