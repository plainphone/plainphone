// SPDX-License-Identifier: Apache-2.0
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { View } from "react-native";
import { client, unwrap } from "../api/client";
import type { PendingChange, Phone } from "../api/models";
import { SosPanel } from "../components/SosPanel";
import { RequireAuth } from "../components/RequireAuth";
import { Button, LinkRow, LiveStatus, LoadGate, PageTitle, Screen, Stack as VStack, Text, useLoad, useNow } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { formatRelative } from "../shared/lib/format";
import { space } from "../lib/theme";

interface Row {
  phone: Phone;
  pending: number;
}

function PhonesList() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const feedback = useMemo(() => notice === "phone-unavailable"
    ? { tone: "warn" as const, text: t("support.phoneUnavailable") }
    : null, [notice, t]);
  const now = useNow(60_000);
  const res = useLoad(async (): Promise<Row[]> => {
    const { phones } = await unwrap<{ phones: Phone[] }>(client.GET("/phones"));
    return Promise.all(
      phones.map(async (phone) => {
        if (phone.profile !== "self") return { phone, pending: 0 };
        try {
          const r = await unwrap<{ changes: PendingChange[] }>(
            client.GET("/phones/{pid}/changes", { params: { path: { pid: phone.id } } }),
          );
          return { phone, pending: r.changes.length };
        } catch {
          return { phone, pending: 0 };
        }
      }),
    );
  }, []);

  // Back from adding, renaming or removing a phone: show the current list.
  const firstFocus = useRef(true);
  const { reload } = res;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false; // useLoad already loads on mount
      else void reload();
    }, [reload]),
  );

  return (
    <Screen testID="phones" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button kind="plain" title={t("native.settings")} onPress={() => router.push("/settings")} testID="open-settings" />
          ),
        }}
      />
      <PageTitle>{t("phones.title")}</PageTitle>
      <LiveStatus notice={feedback} onClose={() => router.setParams({ notice: undefined })} />
      {res.data?.filter(({ phone }) => phone.profile === "child" && phone.pairedAt).map(({ phone }) => (
        <SosPanel key={phone.id} pid={phone.id} phoneName={phone.name} />
      ))}
      <LoadGate res={res}>
        {(rows) =>
          rows.length === 0 ? (
            <VStack>
              <Text variant="heading">{t("phones.emptyTitle")}</Text>
              <Text>{t("phones.emptyBody")}</Text>
              <Button title={t("phones.add")} onPress={() => router.push("/pair")} testID="add-phone" />
            </VStack>
          ) : (
            <VStack gap={space.sm}>
              {rows.map(({ phone, pending }) => (
                <LinkRow
                  key={phone.id}
                  testID={`phone-${phone.id}`}
                  title={phone.name}
                  meta={[
                    t(phone.profile === "child" ? "profile.child" : "profile.self"),
                    phone.mode === "light" ? t("mode.light") : null,
                    phone.lastSeenAt
                      ? t("phones.lastSeen", { when: formatRelative(phone.lastSeenAt, now, locale) })
                      : t("phones.neverSeen"),
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  badge={
                    pending > 0
                      ? t(pending === 1 ? "phones.pendingCount" : "phones.pendingCountMany", { n: pending })
                      : undefined
                  }
                  onPress={() => router.push({ pathname: "/phones/[pid]", params: { pid: phone.id } })}
                />
              ))}
              <View style={{ marginTop: space.sm }}>
                <Button kind="secondary" title={t("phones.add")} onPress={() => router.push("/pair")} testID="add-phone" />
              </View>
            </VStack>
          )
        }
      </LoadGate>
      <VStack gap={space.sm}>
        <LinkRow title={t("nav.approvals")} onPress={() => router.push("/approvals")} testID="open-approvals" />
        <LinkRow title={t("nav.household")} onPress={() => router.push("/household")} testID="open-household" />
      </VStack>
    </Screen>
  );
}

export default function PhonesScreen() {
  return (
    <RequireAuth>
      <PhonesList />
    </RequireAuth>
  );
}
