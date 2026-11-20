// SPDX-License-Identifier: Apache-2.0
//
// The family agreement of a Child phone (docs/family-agreement.md): a few lines in the child's
// words, optional rules for the adults, and where the phone shows them.
import { useState } from "react";
import { Navigate } from "react-router";
import { agreementProblems, AgreementFields, type AgreementDraft } from "../components/AgeControls";
import { errorMessage, LoadGate, PageTitle, Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { type Agreement, parseLines } from "../lib/age";
import { api, getAgreement, type Phone, putAgreement } from "../lib/api";
import { usePhone } from "./Phone";

export function AgreementPage() {
  const { phone } = usePhone();
  const res = useLoad(() => getAgreement(phone.id), [phone.id]);
  if (phone.profile !== "child") return <Navigate to={`/phones/${phone.id}`} replace />;
  return <LoadGate res={res}>{(agreement) => <AgreementForm first={agreement} />}</LoadGate>;
}

function AgreementForm({ first }: { first: Agreement }) {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [saved, setSaved] = useState(first);
  const [draft, setDraft] = useState<AgreementDraft>({ lines: first.lines.join("\n"), adultLines: first.adultLines.join("\n") });
  const [busy, setBusy] = useState(false);
  const problems = agreementProblems(draft);
  const changed = draft.lines !== saved.lines.join("\n") || draft.adultLines !== saved.adultLines.join("\n");

  async function save(fields: Parameters<typeof putAgreement>[1], message: string) {
    setBusy(true);
    try {
      const next = await putAgreement(phone.id, fields);
      setSaved(next);
      setDraft({ lines: next.lines.join("\n"), adultLines: next.adultLines.join("\n") });
      setPhone(await api.get<Phone>(`/phones/${phone.id}`));
      notify({ tone: "success", text: message });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle sub={t("age.agreement.intro")}>{t("age.agreement.title")}</PageTitle>
      <section className="section form-card stack" aria-labelledby="agreement-text-h">
        <h2 id="agreement-text-h" className="sr-only">{t("age.agreement.title")}</h2>
        <AgreementFields draft={draft} onChange={setDraft} disabled={busy} />
        <p className="help">{t("age.agreement.private")}</p>
        <div>
          <button type="button" className="btn btn-primary" disabled={busy || !changed || problems.lines !== null || problems.adultLines !== null}
            onClick={() => void save({ lines: parseLines(draft.lines), adultLines: parseLines(draft.adultLines) }, t("age.agreement.saved"))}>
            {t("age.agreement.save")}
          </button>
        </div>
      </section>
      <section className="section form-card stack" aria-label={t("age.agreement.show")}>
        <Switch label={t("age.agreement.show")} description={t("age.agreement.showHelp")} checked={saved.enabled} disabled={busy}
          onChange={(enabled) => void save({ enabled }, t("app.saved"))} />
        {saved.enabled && (
          <Switch label={t("age.agreement.home")} description={t("age.agreement.homeHelp")} checked={saved.onHome} disabled={busy}
            onChange={(onHome) => void save({ onHome }, t("app.saved"))} />
        )}
      </section>
    </>
  );
}
