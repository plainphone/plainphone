// SPDX-License-Identifier: Apache-2.0
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { Text as RNText, View } from "react-native";
import { client, unwrap } from "../api/client";
import type { PendingChange, Phone } from "../api/models";
import { RequireAuth } from "../components/RequireAuth";
import { Icon } from "../components/Icon";
import { Button, IconButton, LinkRow, List, LoadGate, PageTitle, Screen, Stack as VStack, Text, useLoad, useNow } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { formatRelative } from "../shared/lib/format";
import { space, useColors } from "../lib/theme";

interface Row {
  phone: Phone;
  pending: number;
}

function PhonesList() {
  const { t, locale } = useI18n();
  const router = useRouter();
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
            <IconButton icon="settings" label={t("native.settings")} onPress={() => router.push("/settings")} testID="open-settings" />
          ),
        }}
      />
      <PageTitle>{t("phones.title")}</PageTitle>
      <LoadGate res={res}>
        {(rows) =>
          rows.length === 0 ? (
            <VStack style={{ paddingHorizontal: space.xs }}>
              <Text variant="heading">{t("phones.emptyTitle")}</Text>
              <Text variant="muted">{t("phones.emptyBody")}</Text>
              <View style={{ marginTop: space.sm }}>
                <Button title={t("phones.add")} onPress={() => router.push("/pair")} testID="add-phone" />
              </View>
            </VStack>
          ) : (
            <List>
              {rows.map(({ phone, pending }) => (
                <LinkRow
                  key={phone.id}
                  testID={`phone-${phone.id}`}
                  leading={<Initial name={phone.name} />}
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
              <LinkRow
                tone="accent"
                leading={<AddMark />}
                title={t("phones.add")}
                onPress={() => router.push("/pair")}
                testID="add-phone"
              />
            </List>
          )
        }
      </LoadGate>
      <List>
        <LinkRow title={t("nav.household")} onPress={() => router.push("/household")} testID="open-household" />
        <LinkRow title={t("nav.approvals")} onPress={() => router.push("/approvals")} testID="open-approvals" />
      </List>
    </Screen>
  );
}

/** The phone's first letter in a soft circle, so phones are easy to tell apart. */
function Initial({ name }: { name: string }) {
  const c = useColors();
  const letter = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "";
  return (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}>
      {/* Decorative (the row reads out the name); capped so it stays inside the circle. */}
      <RNText style={{ color: c.accent, fontSize: 17, fontWeight: "700" }} maxFontSizeMultiplier={1.4} importantForAccessibility="no" accessibilityElementsHidden>
        {letter}
      </RNText>
    </View>
  );
}

function AddMark() {
  const c = useColors();
  return (
    <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
      <Icon name="plus" size={22} color={c.accent} />
    </View>
  );
}

export default function PhonesScreen() {
  return (
    <RequireAuth>
      <PhonesList />
    </RequireAuth>
  );
}
