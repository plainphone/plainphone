// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useId, useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, type ChangeResult, type EmergencyOpening, type EmergencyOpenings, type EmergencySettings } from "../lib/api";
import { formatDateTime } from "@plainphone/shared/format";
import { usePhone } from "../pages/Phone";
import { Field, LoadGate, Switch, useLoad } from "./ui";

const ALLOWANCES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function openingName(o: EmergencyOpening): string {
  return o.appLabel || o.packageName;
}

function OpeningList({ openings, withMinutes }: { openings: EmergencyOpening[]; withMinutes: boolean }) {
  const { t, locale } = useI18n();
  return (
    <ul className="emergency-list">
      {openings.map((o) => (
        <li key={o.id}>
          {t("emergency.openingLine", { app: openingName(o), time: formatDateTime(o.openedAt, locale) })}
          {withMinutes && <span className="muted"> · {t("emergency.minutes", { n: o.minutes })}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The Key page's section: a switch, openings per month, this month's use and the history. */
export function EmergencySection() {
  const { t } = useI18n();
  const { phone } = usePhone();
  const headingId = useId();
  // Phones that do not say which mode they use are strong mode.
  const light = phone.mode === "light";
  const res = useLoad(
    () => (light ? api.get<EmergencyOpenings>(`/phones/${phone.id}/emergency-openings`) : Promise.resolve(null)),
    [phone.id, light],
  );
  return (
    <section className="stack" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("emergency.title")}</h2>
      {light ? (
        <LoadGate res={res}>
          {(data) => (data ? <EmergencyForm data={data} onSaved={() => void res.reload()} /> : null)}
        </LoadGate>
      ) : (
        <p className="help">{t("emergency.lightOnly")}</p>
      )}
    </section>
  );
}

function EmergencyForm({ data, onSaved }: { data: EmergencyOpenings; onSaved: () => void }) {
  const { t } = useI18n();
  const { phone, run } = usePhone();
  const [enabled, setEnabled] = useState(data.enabled);
  const [allowance, setAllowance] = useState(String(data.allowance));
  const [saving, setSaving] = useState(false);

  // The form always starts from what the server has saved.
  useEffect(() => {
    setEnabled(data.enabled);
    setAllowance(String(data.allowance));
  }, [data]);

  const dirty = enabled !== data.enabled || Number(allowance) !== data.allowance;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await run(
        () => api.put<ChangeResult>(`/phones/${phone.id}/emergency-openings`, { enabled, allowance: Number(allowance) }),
        t("app.saved"),
      );
      if (r?.status === "applied") onSaved();
      // Waiting for the key (or failed): show the saved values again, not the loosened ones.
      else {
        setEnabled(data.enabled);
        setAllowance(String(data.allowance));
      }
    } catch {
      setEnabled(data.enabled);
      setAllowance(String(data.allowance));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="stack">
        <Switch checked={enabled} onChange={setEnabled} label={t("emergency.switch")} description={t("emergency.help")} disabled={saving} />
        {enabled && (
          <Field label={t("emergency.allowance")}>
            {(p) => (
              <select {...p} className="input-short" value={allowance} onChange={(e) => setAllowance(e.target.value)}>
                {ALLOWANCES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </Field>
        )}
        <p className="help">{t("key.looseningNote")}</p>
        <div>
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving ? t("app.saving") : t("app.save")}
          </button>
        </div>
      </form>
      <p>{t("emergency.used", { used: data.used.count, total: data.allowance })}</p>
      <h3>{t("emergency.history")}</h3>
      {data.openings.length === 0 ? <p className="empty-inline">{t("emergency.none")}</p> : <OpeningList openings={data.openings} withMinutes />}
    </>
  );
}

/** A compact block under a person in "People I help". Nothing when the server did not send it. */
export function EmergencyBlock({ emergency }: { emergency?: (EmergencySettings & { openings?: EmergencyOpening[] }) | null }) {
  const { t } = useI18n();
  if (!emergency) return null;
  const openings = emergency.openings ?? [];
  return (
    <div className="stack emergency-block">
      <p className="row-meta">
        {emergency.enabled ? t("emergency.statusOn", { n: emergency.allowance }) : t("emergency.statusOff")}
        {" · "}
        {t("emergency.used", { used: emergency.used.count, total: emergency.allowance })}
      </p>
      {openings.length > 0 && <OpeningList openings={openings} withMinutes={false} />}
    </div>
  );
}
