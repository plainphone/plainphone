// SPDX-License-Identifier: Apache-2.0
//
// Apps on an iPhone (docs/ios/architecture.md, "App selections"): Apple's coded selection, picked
// on an iPhone with Apple's picker. The parent app cannot read it, so it says where the apps are
// picked and when they were last picked.
import { client, unwrap } from "../api/client";
import type { Phone } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { formatRelative } from "@plainphone/shared/format";
import { LoadGate, Notice, PageTitle, Screen, Text, useLoad, useNow } from "./ui";

interface IosSelectionState {
  selection: string | null;
  source: "parent" | "phone" | null;
  updatedAt: string | null;
}

export function IphoneApps({ phone }: { phone: Phone }) {
  const { t, locale } = useI18n();
  const now = useNow(60_000);
  const res = useLoad(
    () => unwrap<IosSelectionState>(client.GET("/phones/{pid}/ios-selection", { params: { path: { pid: phone.id } } })),
    [phone.id],
  );
  return (
    <Screen testID="iphone-apps">
      <PageTitle sub={t("platform.ios.apps")}>{t("apps.title")}</PageTitle>
      <Notice tone="info" text={t("platform.iphone.appsOnPhone")} />
      <LoadGate res={res}>
        {(s) => (
          <Text variant="muted" testID="iphone-apps-state">
            {s.updatedAt
              ? t("platform.iphone.appsPicked", { when: formatRelative(s.updatedAt, now, locale) })
              : t("platform.iphone.appsNone")}
          </Text>
        )}
      </LoadGate>
    </Screen>
  );
}
