// SPDX-License-Identifier: Apache-2.0
//
// Age presets and the review reminder of a Child phone (docs/age-presets.md), the same page as the
// web dashboard's "Growing up": where the rules start, a date to look at them again, and what could
// open up next.
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { client, unwrap } from "../../../api/client";
import type { Phone } from "../../../api/models";
import { AgePicker, ReviewPicker } from "../../../components/AgeControls";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, errorMessage, Field, LoadGate, Notice, PageTitle, Screen, Stack as VStack, Text, useLoad } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { type AgePreset, type AgePresetId, type AgeState, presetName, suggestionText } from "../../../shared/lib/age";
import { formatDateTime } from "../../../shared/lib/format";

/** A local calendar date (YYYY-MM-DD) in a time zone, for the date field. */
const dayIn = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);

function Loader() {
  const { phone } = usePhone();
  const res = useLoad(async () => ({
    presets: (await unwrap<{ presets: AgePreset[] }>(client.GET("/age-presets"))).presets,
    state: (await unwrap<AgeState>(client.GET("/phones/{pid}/age", { params: { path: { pid: phone.id } } }))),
  }), [phone.id]);
  return (
    <Screen testID="phone-growing" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <LoadGate res={res}>{(data) => <GrowingUp presets={data.presets} first={data.state} />}</LoadGate>
    </Screen>
  );
}

function GrowingUp({ presets, first }: { presets: AgePreset[]; first: AgeState }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { phone, setPhone, notify } = usePhone();
  const [state, setState] = useState(first);
  const [choice, setChoice] = useState<AgePresetId | null>(first.agePreset);
  const [busy, setBusy] = useState(false);
  const [dueDate, setDueDate] = useState(() => (first.review.dueAt ? dayIn(new Date(first.review.dueAt), phone.timezone) : ""));
  const [dateError, setDateError] = useState<string>();
  const review = state.review;
  const params = { params: { path: { pid: phone.id } } };

  /** Runs one call, shows the new state and tells the overview (its "time to review" note follows). */
  async function act(call: () => Promise<AgeState>, saved?: (s: AgeState) => string) {
    setBusy(true);
    try {
      const next = await call();
      setState(next);
      setDueDate(next.review.dueAt ? dayIn(new Date(next.review.dueAt), phone.timezone) : "");
      setPhone(await unwrap<Phone>(client.GET("/phones/{pid}", params)));
      notify({ tone: "success", text: saved ? saved(next) : t("app.saved") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }
  const putReview = (body: { enabled?: boolean; intervalMonths?: number; dueDate?: string }) =>
    () => unwrap<AgeState>(client.PUT("/phones/{pid}/review", { ...params, body: body as never }));

  function saveDate() {
    setDateError(undefined);
    const today = dayIn(new Date(), phone.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today) return setDateError(t("age.review.dateInvalid"));
    if (review.dueAt && dueDate === dayIn(new Date(review.dueAt), phone.timezone)) return;
    void act(putReview({ dueDate }));
  }

  return (
    <VStack>
      <PageTitle sub={t("age.intro")}>{t("age.title")}</PageTitle>
      {review.due ? (
        <Notice tone="info" text={`${t("age.review.dueTitle")}. ${t("age.review.dueBody")}`} />
      ) : null}

      <AgePicker presets={presets} value={choice} onChange={setChoice} disabled={busy} />
      {state.agePreset ? <Text variant="small">{t("age.current", { preset: presetName(t, state.agePreset) })}</Text> : null}
      <Text variant="small">{t("age.applyWarning")}</Text>
      <Button
        testID="age-apply"
        title={t(busy ? "age.applying" : "age.apply")}
        busy={busy}
        disabled={choice === null}
        onPress={() => choice && void act(
          () => unwrap<AgeState>(client.POST("/phones/{pid}/age-preset", { ...params, body: { preset: choice } })),
          () => t("age.applied", { preset: presetName(t, choice) }),
        )}
      />

      <Card>
        <Text variant="heading">{t("age.review.title")}</Text>
        <ReviewPicker
          enabled={review.enabled}
          months={review.intervalMonths}
          disabled={busy}
          onEnabled={(enabled) => void act(putReview({ enabled }))}
          onMonths={(intervalMonths) => void act(putReview({ intervalMonths }))}
        />
        {review.enabled && review.dueAt ? (
          <VStack>
            <Text>{t("age.review.nextOn", { date: formatDateTime(review.dueAt, locale) })}</Text>
            <Field
              testID="review-date"
              label={t("age.review.move")}
              help={t("age.review.dateHint")}
              error={dateError}
              value={dueDate}
              editable={!busy}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={10}
              onChangeText={setDueDate}
              onEndEditing={saveDate}
            />
            {review.suggestions.length > 0 ? (
              <VStack>
                <Text variant="label">{t("age.review.ideas")}</Text>
                {review.suggestions.map((s, i) => <Text key={`${s.kind}-${i}`}>{`• ${suggestionText(t, s)}`}</Text>)}
                <Text variant="small">{t("age.review.release")}</Text>
                <Button kind="secondary" title={t("age.review.releaseLink")} onPress={() => router.dismissTo({ pathname: "/phones/[pid]", params: { pid: phone.id } })} />
              </VStack>
            ) : null}
            <Button
              testID="review-done"
              kind={review.due ? "primary" : "secondary"}
              title={t("age.review.done")}
              busy={busy}
              onPress={() => void act(
                () => unwrap<AgeState>(client.POST("/phones/{pid}/review/done", params)),
                (s) => t("age.review.doneSaved", { date: formatDateTime(s.review.dueAt!, locale) }),
              )}
            />
          </VStack>
        ) : null}
      </Card>
    </VStack>
  );
}

function Gate() {
  const { phone } = usePhone();
  if (phone.profile !== "child") return <Redirect href={{ pathname: "/phones/[pid]", params: { pid: phone.id } }} />;
  return <Loader />;
}

export default function GrowingScreen() {
  return (
    <PhoneGate>
      <Gate />
    </PhoneGate>
  );
}
