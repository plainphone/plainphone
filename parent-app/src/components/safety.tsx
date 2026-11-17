// SPDX-License-Identifier: Apache-2.0
//
// "Ring the phone" and "Are you okay?" on the location screen: the same two sections as
// the PWA (web/src/pages/Location.tsx), as cards with a live status line.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import type { Checkin, Contact, LocationMode, Ring } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { CHECKIN_MINUTES, checkinStatus, ringStatus, type StatusLine } from "../lib/location";
import { radius, space, useColors } from "../lib/theme";
import { CheckRow } from "./parts";
import { Button, Card, Choice, Segmented, Stack as VStack, Text } from "./ui";

/** Tells screen readers when the situation changes (waiting, ringing, answered), not on every tick of the countdown. */
function useAnnounceChanges(status: StatusLine | null, quiet: string[]) {
  const last = useRef<string | null | undefined>(undefined);
  const kind = status?.kind ?? null;
  const text = status?.text ?? null;
  useEffect(() => {
    // The first value is what the screen opened with; only changes after that are news.
    if (last.current !== undefined && kind !== last.current && kind && text && !quiet.includes(kind)) {
      AccessibilityInfo.announceForAccessibility(text);
    }
    last.current = kind;
    // The text changes every second while counting down; the kind is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
}

/**
 * One line about a ring or a check-in. It is not a live region: its countdown changes every
 * second, so changes are announced by useAnnounceChanges instead.
 */
function StatusRow({ status, testID }: { status: StatusLine; testID: string }) {
  const c = useColors();
  const line = status.warn ? c.warnLine : c.accent;
  return (
    <View
      testID={testID}
      accessible
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        backgroundColor: status.warn ? c.warnBg : c.tint,
        borderLeftWidth: 4,
        borderLeftColor: line,
        borderRadius: radius,
        padding: space.md,
      }}
    >
      {status.live ? <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: line }} /> : null}
      <View style={{ flex: 1 }}>
        <Text>{status.text}</Text>
      </View>
    </View>
  );
}

export function RingSection({
  ring,
  now,
  busy,
  onRing,
  onStop,
}: {
  ring: Ring | null;
  now: number;
  busy: string | null;
  onRing: (stopOnAnswer: boolean) => void;
  onStop: () => void;
}) {
  const { t, locale } = useI18n();
  const [keep, setKeep] = useState(false);
  const status = ringStatus(ring, now, t, locale);
  // Stopping is announced by the note that follows it.
  useAnnounceChanges(status, ["stopped"]);

  return (
    <Card testID="ring-section">
      <VStack gap={space.xs}>
        <Text variant="heading">{t("ring.title")}</Text>
        <Text variant="muted">{t("ring.intro")}</Text>
      </VStack>
      {status ? <StatusRow testID="ring-status" status={status} /> : null}
      {status?.live ? (
        <Button testID="ring-stop" kind="danger" title={t("ring.stop")} busy={busy === "ring-stop"} onPress={onStop} />
      ) : (
        <>
          <CheckRow testID="ring-keep" label={t("ring.keep")} checked={keep} onToggle={() => setKeep(!keep)} />
          <Button testID="ring-start" title={t("ring.start")} busy={busy === "ring"} onPress={() => onRing(!keep)} />
        </>
      )}
    </Card>
  );
}

const NO_CALL = "none";

export function CheckinSection({
  checkin,
  mode,
  contacts,
  ready,
  now,
  busy,
  onSend,
  onCancel,
}: {
  checkin: Checkin | null;
  mode: LocationMode;
  contacts: Contact[];
  /** The contacts have loaded (or failed to), so the default for "Call me" is known. */
  ready: boolean;
  now: number;
  busy: string | null;
  onSend: (minutes: number, callNumber: string | null) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useI18n();
  const [minutes, setMinutes] = useState<number>(10);
  const [picked, setPicked] = useState<string | null>(null);
  // The first approved contact unless the parent chose otherwise (or the choice is gone).
  const number = picked !== null && (picked === NO_CALL || contacts.some((c) => c.number === picked)) ? picked : (contacts[0]?.number ?? NO_CALL);
  const status = checkinStatus(checkin, now, t, locale);
  const waiting = checkin?.status === "waiting";
  const sends = mode === "checkin" || mode === "always";
  useAnnounceChanges(status, ["cancelled"]);

  return (
    <Card testID="checkin-section">
      <VStack gap={space.xs}>
        <Text variant="heading">{t("checkin.title")}</Text>
        <Text variant="muted">{t(sends ? "checkin.intro" : "checkin.introNoLocation")}</Text>
      </VStack>
      {status ? <StatusRow testID="checkin-status" status={status} /> : null}
      {waiting ? (
        <Button testID="checkin-cancel" kind="secondary" title={t("checkin.cancel")} busy={busy === "checkin-stop"} onPress={onCancel} />
      ) : (
        <>
          <Segmented<number>
            testID="checkin-minutes"
            label={t("checkin.minutes")}
            value={minutes}
            onChange={setMinutes}
            options={CHECKIN_MINUTES.map((m) => ({ value: m, label: t("checkin.minutesN", { n: m }), testID: `checkin-minutes-${m}` }))}
          />
          {!ready ? null : contacts.length > 0 ? (
            <Choice<string>
              testID="checkin-call"
              label={t("checkin.callMe")}
              hint={t("checkin.callMeHelp")}
              value={number}
              onChange={setPicked}
              options={[
                ...contacts.map((c) => ({ value: c.number, label: `${c.name} (${c.number})`, testID: `checkin-call-${c.number}` })),
                { value: NO_CALL, label: t("checkin.noCall"), testID: "checkin-call-none" },
              ]}
            />
          ) : (
            <Text variant="muted">{t("checkin.noContacts")}</Text>
          )}
          <Button testID="checkin-send" title={t("checkin.send")} busy={busy === "checkin"} disabled={!ready} onPress={() => onSend(minutes, number === NO_CALL ? null : number)} />
        </>
      )}
    </Card>
  );
}
