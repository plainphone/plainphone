// SPDX-License-Identifier: Apache-2.0
//
// Requests for more time on one phone: open ones with four answers, answered and expired ones
// below as a quiet result. Same states and copy as the dashboard (src/shared/lib/more-time).
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { client, unwrap } from "../api/client";
import type { Phone } from "../api/models";
import { useI18n } from "../i18n/I18n";
import { answerMoreTime } from "../lib/moreTime";
import { radius, space, useColors } from "../lib/theme";
import { formatDateTime } from "../shared/lib/format";
import { ANSWER_KEY, byKey, merge, MORE_TIME_ANSWERS, type MoreTimeAnswer, type MoreTimeRequest, resultOf } from "../shared/lib/more-time";
import { ItemRow } from "./parts";
import { usePhone } from "./PhoneContext";
import { Button, Card, errorMessage, Row, Stack as VStack, Switch, Text, useLoad } from "./ui";

export interface MoreTimeListProps {
  phoneName: string;
  requests: MoreTimeRequest[];
  /** The request being sent. Its buttons are off, so a second tap cannot send it twice. */
  busy: string | null;
  /** Requests whose answer lost to an earlier one: they say so, calmly. */
  alreadyAnswered: ReadonlySet<string>;
  onAnswer: (r: MoreTimeRequest, answer: MoreTimeAnswer) => void;
}

export function MoreTimeList({ phoneName, requests, busy, alreadyAnswered, onAnswer }: MoreTimeListProps) {
  const { t, locale } = useI18n();
  const c = useColors();
  if (requests.length === 0) return null;
  const title = (r: MoreTimeRequest) =>
    r.appLabel === null ? t("moreTime.askTotal", { phone: phoneName }) : t("moreTime.askApp", { phone: phoneName, app: r.appLabel });
  const open = requests.filter((r) => r.status === "pending");
  const done = requests.filter((r) => r.status !== "pending");
  return (
    <View testID="more-time" style={{ gap: space.md }}>
      <Text variant="heading">{t("moreTime.title")}</Text>
      <VStack gap={space.sm}>
        {open.map((r) => (
          <ItemRow
            key={r.id}
            testID={`more-time-${r.id}`}
            title={title(r)}
            meta={[r.reason ? t("moreTime.reason", { reason: r.reason }) : null, formatDateTime(r.createdAt, locale)].filter(Boolean).join("\n")}
          >
            <Row>
              {MORE_TIME_ANSWERS.map((a) => (
                <Button
                  key={a}
                  testID={`more-time-${r.id}-${a}`}
                  kind={a === "no" ? "secondary" : "primary"}
                  title={t(ANSWER_KEY[a])}
                  accessibilityLabel={`${t(ANSWER_KEY[a])}: ${title(r)}`}
                  disabled={busy !== null}
                  busy={busy === r.id}
                  onPress={() => onAnswer(r, a)}
                />
              ))}
            </Row>
          </ItemRow>
        ))}
        {done.map((r) => {
          const res = resultOf(r);
          const by = byKey(r);
          const outcome = res ? [t(res.key, { minutes: res.minutes ?? 0 }), by ? t(by) : null].filter(Boolean).join(". ") : null;
          return (
            <View
              key={r.id}
              testID={`more-time-done-${r.id}`}
              accessible
              accessibilityLabel={[title(r), outcome, alreadyAnswered.has(r.id) ? t("moreTime.alreadyAnswered") : null].filter(Boolean).join(". ")}
              style={{ backgroundColor: c.tint, borderRadius: radius, padding: space.md, gap: 2 }}
            >
              <Text variant="label">{title(r)}</Text>
              {r.reason ? <Text variant="small">{t("moreTime.reason", { reason: r.reason })}</Text> : null}
              {outcome ? <Text variant="label" style={{ marginTop: space.xs }}>{outcome}</Text> : null}
              {alreadyAnswered.has(r.id) ? <Text variant="small">{t("moreTime.alreadyAnswered")}</Text> : null}
            </View>
          );
        })}
      </VStack>
    </View>
  );
}

/** The two switches next to the screen time rules. Both default to on, also for servers that do not send them. */
export function MoreTimeSettings() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [saving, setSaving] = useState(false);

  async function toggle(setting: "askMoreTimeEnabled" | "limitWarningEnabled", enabled: boolean) {
    setSaving(true);
    try {
      setPhone(await unwrap<Phone>(client.PATCH("/phones/{pid}", {
        params: { path: { pid: phone.id } }, body: { [setting]: enabled },
      })));
    } catch (error) {
      notify({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <Switch testID="time-ask-switch" label={t("time.askSwitch")} help={t("time.askHelp")}
        value={phone.askMoreTimeEnabled !== false} disabled={saving}
        onValueChange={(value) => void toggle("askMoreTimeEnabled", value)} />
      <Switch testID="time-warn-switch" label={t("time.warnSwitch")} help={t("time.warnHelp")}
        value={phone.limitWarningEnabled !== false} disabled={saving}
        onValueChange={(value) => void toggle("limitWarningEnabled", value)} />
    </Card>
  );
}

/** Loads the phone's requests and answers them. Shows nothing while there are none, or on an old server. */
export function MoreTimeRequests() {
  const { t } = useI18n();
  const { phone, notify } = usePhone();
  const res = useLoad(
    async () => (await unwrap<{ requests: MoreTimeRequest[] }>(
      client.GET("/phones/{pid}/more-time-requests", { params: { path: { pid: phone.id } } }),
    )).requests,
    [phone.id],
  );
  const { reload, setData } = res;
  const [busy, setBusy] = useState<string | null>(null);
  const [lost, setLost] = useState<ReadonlySet<string>>(new Set());

  // Back from another screen or from the background: someone may have asked or answered meanwhile.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) firstFocus.current = false; // useLoad already loads on mount
    else void reload();
  }, [reload]));

  async function answer(r: MoreTimeRequest, a: MoreTimeAnswer) {
    setBusy(r.id);
    try {
      const out = await answerMoreTime(phone.id, r.id, a);
      setData((list) => list && merge(list, { ...out, phoneId: r.phoneId, appLabel: r.appLabel }));
      if (!out.won) setLost((s) => new Set(s).add(r.id));
    } catch {
      notify({ tone: "error", text: t("moreTime.answerFailed") });
      void reload();
    } finally {
      setBusy(null);
    }
  }

  return <MoreTimeList phoneName={phone.name} requests={res.data ?? []} busy={busy} alreadyAnswered={lost} onAnswer={(r, a) => void answer(r, a)} />;
}
