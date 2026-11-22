// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { client, unwrap } from "../../../api/client";
import type { App, ChangeResult } from "../../../api/models";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Card, errorMessage, Field, LoadGate, PageTitle, Screen, Stack as VStack, Switch, Text, useLoad } from "../../../components/ui";
import { OpenModePanel } from "../../../components/OpenMode";
import { useI18n } from "../../../i18n/I18n";
import type { MessageKey } from "@plainphone/i18n/translate";
import { space } from "../../../lib/theme";
import { IphoneApps } from "../../../components/IphoneApps";
import { isIphone } from "@plainphone/shared/platform";

function AppsList() {
  const { t, locale } = useI18n();
  const { phone, run, setApps, pending, notify } = usePhone();
  const res = useLoad(
    () => unwrap<{ apps: App[] }>(client.GET("/phones/{pid}/apps", { params: { path: { pid: phone.id } } })).then((r) => r.apps),
    [phone.id],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (res.data) setApps(res.data);
  }, [res.data, setApps]);

  const waiting = useMemo(
    () => new Set(pending.flatMap((c) => (c.op.type === "app.set" ? [c.op.packageName] : []))),
    [pending],
  );

  const open = phone.openMode === true;

  async function toggle(app: App, allowed: boolean) {
    setBusy(app.packageName);
    try {
      const r = await run(
        () =>
          unwrap<ChangeResult>(
            client.PUT("/phones/{pid}/apps/{package}", {
              params: { path: { pid: phone.id, package: app.packageName } },
              body: { allowed },
            }),
          ),
        open ? t(allowed ? "apps.unblockedOne" : "apps.blockedOne", { app: app.label }) : t(allowed ? "apps.shown" : "apps.hidden", { app: app.label }),
      );
      if (r?.status === "applied") {
        res.setData((list) => list?.map((a) => (a.packageName === app.packageName ? { ...a, allowed, blocked: !allowed } : a)));
      }
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen testID="phone-apps" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t(open ? "apps.introOpen" : "apps.intro")}>{t("apps.title")}</PageTitle>
      {phone.openMode !== undefined ? <OpenModePanel onChanged={() => void res.reload()} /> : null}
      <LoadGate res={res}>
        {(apps) => {
          if (apps.length === 0) return <Text variant="muted">{t("apps.empty")}</Text>;
          const needle = q.trim().toLocaleLowerCase(locale);
          const shown = needle ? apps.filter((a) => a.label.toLocaleLowerCase(locale).includes(needle)) : apps;
          const sorted = [...shown].sort((a, b) => Number(b.core) - Number(a.core) || a.label.localeCompare(b.label, locale));
          return (
            <VStack>
              {apps.length > 10 ? (
                <Field
                  testID="apps-search"
                  label={t("apps.filter")}
                  value={q}
                  onChangeText={setQ}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              ) : null}
              {sorted.length === 0 ? (
                <Text variant="muted">{t("apps.noMatch", { q })}</Text>
              ) : (
                <Card style={{ gap: space.xs }}>
                  {sorted.map((a) => (
                    <Switch
                      key={a.packageName}
                      testID={`app-${a.packageName}`}
                      label={a.label}
                      value={open ? !a.blocked : a.allowed || a.core}
                      disabled={a.core || busy === a.packageName || (open && Boolean(a.blockedBy))}
                      help={
                        a.core
                          ? t("apps.core")
                          : open && a.blockedBy
                            ? t("apps.viaCategory", { category: t(`open.cat.${a.blockedBy}` as MessageKey).toLocaleLowerCase(locale === "da" ? "da-DK" : "en-GB") })
                            : waiting.has(a.packageName)
                              ? t("pending.waitingTag")
                              : undefined
                      }
                      onValueChange={(v) => void toggle(a, v)}
                    />
                  ))}
                </Card>
              )}
              <Text variant="small">{t("apps.coreHelp")}</Text>
            </VStack>
          );
        }}
      </LoadGate>
    </Screen>
  );
}

/** An iPhone's apps are Apple's coded selection, not package names (docs/ios/architecture.md). */
function AppsForPlatform() {
  const { phone } = usePhone();
  return isIphone(phone) ? <IphoneApps phone={phone} /> : <AppsList />;
}

export default function AppsScreen() {
  return (
    <PhoneGate>
      <AppsForPlatform />
    </PhoneGate>
  );
}
