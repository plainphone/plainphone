// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import { api, type ChangeResult, type Phone } from "../lib/api";
import { errorMessage, type Notice, LiveStatus, Field } from "./ui";

interface Exported {
  bundle: string;
  exportId: string;
  phoneIds: string[];
}

export function HouseholdMove({ householdId }: { householdId: string }) {
  const { t } = useI18n();
  const base = `/households/${householdId}/server-move` as const;
  const [open, setOpen] = useState(false);
  const [phones, setPhones] = useState<Phone[]>([]);
  const [source, setSource] = useState("");
  const [ticket, setTicket] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [exported, setExported] = useState<Exported | null>(null);
  const [requested, setRequested] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try { await action(); }
    catch (err) {
      setNotice({ tone: "error", text: err instanceof SyntaxError ? t("move.invalid") : errorMessage(err, t) });
    } finally { setBusy(false); }
  }

  async function download() {
    const reply = await api.post<Exported>(`${base}/export`, { ticket: JSON.parse(ticket), ...(phoneId && { phoneId }) });
    const url = URL.createObjectURL(new Blob([reply.bundle], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "plainphone-move.jwe";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setExported(reply);
    setRequested([]);
  }

  return (
    <details className="section panel" onToggle={(event) => {
      if (!event.currentTarget.open || open) return;
      setOpen(true);
      void run(async () => setPhones((await api.get<{ phones: Phone[] }>(`${base}/phones`)).phones));
    }}>
      <summary>{t("move.title")}</summary>
      <p>{t("move.openBoth")}</p>
      <LiveStatus notice={notice} />
      <ol>
        <li>
          <button type="button" className="btn btn-secondary" disabled={busy}
            onClick={() => void run(async () => setSource(JSON.stringify(await api.get(`${base}/source`))))}>{t("move.source")}</button>
          <Field label={t("move.sourceCode")}>
            {(props) => <textarea {...props} rows={3} value={source} onChange={(e) => setSource(e.target.value)} autoComplete="off" />}
          </Field>
        </li>
        <li>
          <button type="button" className="btn btn-secondary" disabled={busy || !source}
            onClick={() => void run(async () => setTicket(JSON.stringify(await api.post(`${base}/prepare`, JSON.parse(source)))))}>{t("move.prepare")}</button>
          <Field label={t("move.invitation")}>
            {(props) => <textarea {...props} rows={3} value={ticket} onChange={(e) => setTicket(e.target.value)} autoComplete="off" />}
          </Field>
        </li>
        <li>
          <Field label={t("move.phone")}>
            {(props) => <select {...props} value={phoneId} onChange={(e) => setPhoneId(e.target.value)}>
              <option value="">{t("move.allPhones")}</option>
              {phones.map((phone) => <option key={phone.id} value={phone.id}>{phone.name}</option>)}
            </select>}
          </Field>
          <button type="button" className="btn btn-secondary" disabled={busy || !ticket}
            onClick={() => void run(download)}>{t("move.download")}</button>
        </li>
        <li>
          <Field label={t("move.file")}>
            {(props) => <input {...props} type="file" accept=".jwe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <button type="button" className="btn btn-secondary" disabled={busy || !ticket || !file}
            onClick={() => void run(async () => {
              if (!file || file.size > 8 * 1024 * 1024) throw new SyntaxError();
              await api.post(`${base}/import`, { ticketId: JSON.parse(ticket).id, bundle: (await file.text()).trim() });
              setNotice({ tone: "success", text: t("move.imported") });
            })}>{t("move.import")}</button>
        </li>
        {exported && exported.phoneIds.length > 0 && <li>
          {t("move.start")}
          <p>{t("move.startHelp")}</p>
          {phones.filter((phone) => exported.phoneIds.includes(phone.id)).map((phone) => (
            <button key={phone.id} type="button" className="btn btn-secondary" disabled={busy || requested.includes(phone.id)}
              onClick={() => void run(async () => {
                const result = await api.post<ChangeResult>(`/phones/${phone.id}/server-move/start`, { exportId: exported.exportId });
                setRequested((ids) => [...ids, phone.id]);
                setNotice({ tone: "success", text: t(result.status === "pending" ? "pending.waitingTag" : "move.requested") });
              })}>{t("move.startPhone", { name: phone.name })}</button>
          ))}
        </li>}
      </ol>
    </details>
  );
}
