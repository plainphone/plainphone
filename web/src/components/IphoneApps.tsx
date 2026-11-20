// SPDX-License-Identifier: Apache-2.0
//
// Apps on an iPhone (docs/ios/architecture.md, "App selections"): Apple's coded selection, picked
// on an iPhone with Apple's picker. The dashboard cannot read it, so it says where the apps are
// picked and when they were last picked.
import { LoadGate, PageTitle, useLoad, useNow } from "./ui";
import { useI18n } from "../i18n/I18n";
import { api, type IosSelectionState, type Phone } from "../lib/api";
import { formatRelative } from "../lib/format";

export function IphoneApps({ phone }: { phone: Phone }) {
  const { t, locale } = useI18n();
  const now = useNow(60_000);
  const res = useLoad(() => api.get<IosSelectionState>(`/phones/${phone.id}/ios-selection`), [phone.id]);
  return (
    <>
      <PageTitle sub={t("platform.ios.apps")}>{t("apps.title")}</PageTitle>
      <p className="notice notice-info">{t("platform.iphone.appsOnPhone")}</p>
      <LoadGate res={res}>
        {(s) => (
          <p className="help">
            {s.updatedAt
              ? t("platform.iphone.appsPicked", { when: formatRelative(s.updatedAt, now, locale) })
              : t("platform.iphone.appsNone")}
          </p>
        )}
      </LoadGate>
    </>
  );
}
