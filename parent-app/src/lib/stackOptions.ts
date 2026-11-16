// SPDX-License-Identifier: Apache-2.0
//
// The look shared by every stack in the app: calm background, accent back button.
import { useI18n } from "../i18n/I18n";
import { useColors } from "./theme";

export function useStackOptions() {
  const c = useColors();
  const { t } = useI18n();
  return {
    headerStyle: { backgroundColor: c.bg },
    headerTintColor: c.accent,
    headerTitleStyle: { color: c.ink },
    headerShadowVisible: false,
    headerBackTitle: t("app.back"),
    contentStyle: { backgroundColor: c.bg },
  };
}
