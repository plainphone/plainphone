// SPDX-License-Identifier: Apache-2.0
//
// Age presets and the review reminder of a Child phone (docs/age-presets.md): where the rules
// start, a date to look at them again, and what could open up next.
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { AgePicker, ReviewPicker } from "../components/AgeControls";
import { errorMessage, Field, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { type AgePresetId, type AgeState, presetName, suggestionText } from "@plainphone/shared/age";
import { api, applyAgePreset, getAgePresets, getAgeState, markReviewed, type Phone, putReview } from "../lib/api";
import { intlLocale } from "@plainphone/shared/format";
import { usePhone } from "./Phone";

/** A local calendar date (YYYY-MM-DD) in a time zone, for the date field. */
const dayIn = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);

export function GrowingUpPage() {
  const { phone } = usePhone();
  const res = useLoad(async () => ({ presets: await getAgePresets(), state: await getAgeState(phone.id) }), [phone.id]);
  if (phone.profile !== "child") return <Navigate to={`/phones/${phone.id}`} replace />;
  return <LoadGate res={res}>{(data) => <GrowingUp presets={data.presets} first={data.state} />}</LoadGate>;
}

function GrowingUp({ presets, first }: { presets: Awaited<ReturnType<typeof getAgePresets>>; first: AgeState }) {
  const { t, locale } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [state, setState] = useState(first);
  const [choice, setChoice] = useState<AgePresetId | null>(first.agePreset);
  const [busy, setBusy] = useState(false);
  const [dueDate, setDueDate] = useState(() => (first.review.dueAt ? dayIn(new Date(first.review.dueAt), phone.timezone) : ""));
  const today = dayIn(new Date(), phone.timezone);
  const review = state.review;
  const dateText = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: phone.timezone }).format(new Date(iso));

  /** Runs one call, shows the new state and tells the overview (its "time to review" note follows). */
  async function act(call: () => Promise<AgeState>, saved?: (s: AgeState) => string) {
    setBusy(true);
    try {
      const next = await call();
      setState(next);
      setDueDate(next.review.dueAt ? dayIn(new Date(next.review.dueAt), phone.timezone) : "");
      setPhone(await api.get<Phone>(`/phones/${phone.id}`));
      notify({ tone: "success", text: saved ? saved(next) : t("app.saved") });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle sub={t("age.intro")}>{t("age.title")}</PageTitle>

      {review.due && (
        <section className="section notice notice-info" aria-labelledby="review-due-h">
          <h2 id="review-due-h" className="h3">{t("age.review.dueTitle")}</h2>
          <p>{t("age.review.dueBody")}</p>
        </section>
      )}

      <section className="section stack" aria-labelledby="age-h">
        <h2 id="age-h">{t("age.presetLabel")}</h2>
        {state.agePreset && <p className="help">{t("age.current", { preset: presetName(t, state.agePreset) })}</p>}
        <AgePicker presets={presets} value={choice} onChange={setChoice} name="age" disabled={busy} />
        <p className="help">{t(phone.modesEnabled ? "age.applyWarningModes" : "age.applyWarning")}</p>
        <div>
          <button type="button" className="btn btn-primary" disabled={busy || choice === null}
            onClick={() => choice && void act(() => applyAgePreset(phone.id, choice), () => t("age.applied", { preset: presetName(t, choice) }))}>
            {t(busy ? "age.applying" : "age.apply")}
          </button>
        </div>
      </section>

      <section className="section form-card stack" aria-labelledby="review-h">
        <h2 id="review-h">{t("age.review.title")}</h2>
        <ReviewPicker
          enabled={review.enabled}
          months={review.intervalMonths}
          disabled={busy}
          onEnabled={(enabled) => void act(() => putReview(phone.id, { enabled }))}
          onMonths={(intervalMonths) => void act(() => putReview(phone.id, { intervalMonths }))}
        />
        {review.enabled && review.dueAt && (
          <>
            <p>{t("age.review.nextOn", { date: dateText(review.dueAt) })}</p>
            <Field label={t("age.review.move")}>
              {(p) => (
                <input {...p} type="date" value={dueDate} min={today} disabled={busy}
                  onChange={(e) => setDueDate(e.target.value)}
                  onBlur={() => {
                    if (!dueDate || dueDate === dayIn(new Date(review.dueAt!), phone.timezone)) return;
                    if (dueDate < today) return notify({ tone: "error", text: t("age.review.dateInvalid") });
                    void act(() => putReview(phone.id, { dueDate }));
                  }} />
              )}
            </Field>
            {review.suggestions.length > 0 && (
              <div className="stack-sm">
                <h3 className="h3">{t("age.review.ideas")}</h3>
                <ul>
                  {review.suggestions.map((s, i) => <li key={`${s.kind}-${i}`}>{suggestionText(t, s)}</li>)}
                </ul>
              </div>
            )}
            <div>
              <button type="button" className={review.due ? "btn btn-primary" : "btn btn-secondary"} disabled={busy}
                onClick={() => void act(() => markReviewed(phone.id), (s) => t("age.review.doneSaved", { date: dateText(s.review.dueAt!) }))}>
                {t("age.review.done")}
              </button>
            </div>
          </>
        )}
        <p className="help">{t("age.review.release")} <Link to={{ pathname: `/phones/${phone.id}`, hash: "manage-h" }}>{t("age.review.releaseLink")}</Link></p>
      </section>
    </>
  );
}
