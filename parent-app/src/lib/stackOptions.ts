// SPDX-License-Identifier: Apache-2.0
//
// The look shared by every stack in the app: a quiet bar on the page colour with only
// the back button and actions in it. Each screen shows its own large title in the page
// (like iOS large titles and Material's large top app bar), so the bar has no title text.
// `title` is still set per screen: iOS uses it for the back button ("‹ Alma") and the
// web build for the document title.
import { useColors } from "./theme";

export function useStackOptions() {
  const c = useColors();
  return {
    headerStyle: { backgroundColor: c.bg },
    headerTintColor: c.accent,
    headerTitleStyle: { color: c.ink },
    headerTitle: "",
    headerShadowVisible: false,
    contentStyle: { backgroundColor: c.bg },
  };
}
