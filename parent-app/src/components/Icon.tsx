// SPDX-License-Identifier: Apache-2.0
//
// The few line icons the app uses, drawn with react-native-svg (no icon font).
// Decorative: hidden from screen readers; the control around them carries the label.
import Svg, { Circle, Path } from "react-native-svg";

export type IconName = "chevron" | "settings" | "plus" | "check";

export function Icon({ name, size = 20, color, strokeWidth = 2 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const common = { fill: "none", stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === "chevron" ? <Path d="M9 5.5 15.5 12 9 18.5" {...common} /> : null}
      {name === "plus" ? <Path d="M12 5v14M5 12h14" {...common} /> : null}
      {name === "check" ? <Path d="M5 12.5 10 17.5 19 7" {...common} /> : null}
      {name === "settings" ? (
        <>
          {/* Three sliders: the app's settings are a handful of simple choices. */}
          <Path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h3.5M11.5 12H20" {...common} />
          <Circle cx={15} cy={7} r={2} {...common} />
          <Circle cx={9} cy={17} r={2} {...common} />
          <Circle cx={9.5} cy={12} r={2} {...common} />
        </>
      ) : null}
    </Svg>
  );
}
