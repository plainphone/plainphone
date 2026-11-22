// SPDX-License-Identifier: Apache-2.0
//
// An SOS that arrives while the app is open: a banner over the screen with a vibration, so it is
// noticed at once. The details come through the normal API (live events carry ids only). Each SOS
// alerts once. The push notification for the same SOS still arrives; it plays the sound
// (see the notification handler) and covers the app being closed.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { client, unwrap } from "../api/client";
import type { Phone } from "../api/models";
import type { components } from "@plainphone/api-client/schema";
import { useI18n } from "../i18n/I18n";
import { useLive, useLiveEvent } from "../lib/live";
import { radius, space, useColors } from "../lib/theme";
import { Button, Text } from "./ui";

type SosEvent = components["schemas"]["SosEvent"];

interface Alert {
  id: string;
  phoneId: string;
  name: string | null;
  urgent: boolean;
}

const MAX_SHOWN = 3;
const VIBRATION = [0, 500, 250, 500, 250, 500];

export function SosAlert() {
  const { t } = useI18n();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useLive();
  const sosAlert = useRef(settings.sosAlert);
  useEffect(() => {
    sosAlert.current = settings.sosAlert;
  });
  const seen = useRef(new Set<string>());
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const onCreated = useCallback(async (phoneId: string, id: string | undefined) => {
    if (id) {
      if (seen.current.has(id)) return;
      seen.current.add(id);
    }
    if (sosAlert.current) Vibration.vibrate(VIBRATION);
    let name: string | null = null;
    let urgent = false;
    try {
      const [phone, history] = await Promise.all([
        unwrap<Phone>(client.GET("/phones/{pid}", { params: { path: { pid: phoneId } } })),
        unwrap<{ events: SosEvent[] }>(client.GET("/phones/{pid}/sos", { params: { path: { pid: phoneId }, query: { unseen: "1" } } })),
      ]);
      name = phone.name;
      urgent = history.events.find((e) => e.id === id)?.kind === "urgent";
    } catch {
      // The banner still shows, without a name: an SOS must not be lost to a failed lookup.
    }
    setAlerts((all) => [{ id: id ?? `${phoneId}-${Date.now()}`, phoneId, name, urgent }, ...all].slice(0, MAX_SHOWN));
  }, []);
  useLiveEvent(["sos.created"], undefined, (e) => void onCreated(e.phoneId, e.id));

  if (alerts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + space.sm, left: space.md, right: space.md, gap: space.sm, zIndex: 100 }}>
      {alerts.map((a) => {
        const what = t(a.urgent ? "sos.urgent" : "sos.help");
        const title = a.name ? t("native.liveSosFrom", { name: a.name }) : t("native.liveSosUnknown");
        return (
          <View
            key={a.id}
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            testID="sos-alert"
            style={{ backgroundColor: c.dangerBg, borderColor: c.danger, borderWidth: 2, borderRadius: radius, padding: space.md, gap: space.sm }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}. ${what}`}
              accessibilityHint={t("live.sosOpen")}
              testID="sos-alert-open"
              style={{ minHeight: 56, justifyContent: "center", gap: space.xs }}
              onPress={() => {
                setAlerts((all) => all.filter((x) => x.id !== a.id));
                router.push({ pathname: "/phones/[pid]", params: { pid: a.phoneId } });
              }}
            >
              <Text variant="heading" style={{ color: c.danger }}>{title}</Text>
              <Text>{what}</Text>
              <Text variant="label">{t("live.sosOpen")}</Text>
            </Pressable>
            <Button kind="plain" title={t("live.sosDismiss")} testID="sos-alert-close" onPress={() => setAlerts((all) => all.filter((x) => x.id !== a.id))} />
          </View>
        );
      })}
    </View>
  );
}
