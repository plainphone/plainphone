// SPDX-License-Identifier: Apache-2.0
//
// The family agreement of a Child phone (docs/family-agreement.md), the same page as the web
// dashboard's: a few lines in the child's words, optional rules for the adults, and where the phone
// shows them.
import { Redirect } from "expo-router";
import { useState } from "react";
import { client, unwrap } from "../../../api/client";
import type { Phone } from "../../../api/models";
import { AgreementFields, type AgreementDraft, agreementProblems } from "../../../components/AgeControls";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, errorMessage, LoadGate, PageTitle, Screen, Stack as VStack, Switch, Text, useLoad } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { type Agreement, parseLines } from "../../../shared/lib/age";

type Fields = Partial<Pick<Agreement, "lines" | "adultLines" | "enabled" | "onHome">>;

function Loader() {
  const { phone } = usePhone();
  const res = useLoad(() => unwrap<Agreement>(client.GET("/phones/{pid}/agreement", { params: { path: { pid: phone.id } } })), [phone.id]);
  return (
    <Screen testID="phone-agreement" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <LoadGate res={res}>{(agreement) => <AgreementForm first={agreement} />}</LoadGate>
    </Screen>
  );
}

function AgreementForm({ first }: { first: Agreement }) {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const [saved, setSaved] = useState(first);
  const [draft, setDraft] = useState<AgreementDraft>({ lines: first.lines.join("\n"), adultLines: first.adultLines.join("\n") });
  const [busy, setBusy] = useState(false);
  const problems = agreementProblems(draft);
  const changed = draft.lines !== saved.lines.join("\n") || draft.adultLines !== saved.adultLines.join("\n");

  async function save(fields: Fields, message: string) {
    setBusy(true);
    try {
      const next = await unwrap<Agreement>(client.PUT("/phones/{pid}/agreement", { params: { path: { pid: phone.id } }, body: fields as never }));
      setSaved(next);
      setDraft({ lines: next.lines.join("\n"), adultLines: next.adultLines.join("\n") });
      setPhone(await unwrap<Phone>(client.GET("/phones/{pid}", { params: { path: { pid: phone.id } } })));
      notify({ tone: "success", text: message });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack>
      <PageTitle sub={t("age.agreement.intro")}>{t("age.agreement.title")}</PageTitle>
      <AgreementFields draft={draft} onChange={setDraft} disabled={busy} />
      <Text variant="small">{t("age.agreement.private")}</Text>
      <Button
        testID="agreement-save"
        title={t("age.agreement.save")}
        busy={busy}
        disabled={!changed || problems.lines !== null || problems.adultLines !== null}
        onPress={() => void save({ lines: parseLines(draft.lines), adultLines: parseLines(draft.adultLines) }, t("age.agreement.saved"))}
      />
      <Card>
        <Switch testID="agreement-enabled" label={t("age.agreement.show")} help={t("age.agreement.showHelp")} value={saved.enabled} disabled={busy}
          onValueChange={(enabled) => void save({ enabled }, t("app.saved"))} />
        {saved.enabled ? (
          <Switch testID="agreement-home" label={t("age.agreement.home")} help={t("age.agreement.homeHelp")} value={saved.onHome} disabled={busy}
            onValueChange={(onHome) => void save({ onHome }, t("app.saved"))} />
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

export default function AgreementScreen() {
  return (
    <PhoneGate>
      <Gate />
    </PhoneGate>
  );
}
