// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { LoadGate, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api } from "../lib/api";

type Suggestion = { id: string; name: string; numbers: string[] };

type Review = { action: "approve" | "reject"; id: string } | { action: "approveAll"; suggestionIds: string[] };

export function ContactSuggestions({ phoneId, onApproved }: { phoneId: string; onApproved: () => Promise<void> }) {
  const { t } = useI18n();
  const path = `/phones/${phoneId}/contact-suggestions`;
  const result = useLoad(() => api.get<{ suggestions: Suggestion[] }>(path).then((r) => r.suggestions), [path]);
  const shown = result.data ?? [];
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function review(input: Review) {
    setBusy(true);
    setFailed(false);
    try {
      await api.post<void>(path, input);
      await result.reload();
      if (input.action !== "reject") await onApproved();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="suggested-contacts">
      <div className="section-head">
        <h2 id="suggested-contacts">{t("contacts.suggestions")}</h2>
        {shown.length > 0 && (
          <button type="button" className="btn btn-secondary" disabled={busy || result.loading} onClick={() => void review({ action: "approveAll", suggestionIds: shown.map(({ id }) => id) })}>
            {t("contacts.approveAll")}
          </button>
        )}
      </div>
      {failed && <p role="alert">{t("contacts.suggestionsError")}</p>}
      <LoadGate res={result}>
        {(suggestions) => suggestions.length === 0 ? (
          <p className="empty-inline">{t("contacts.noSuggestions")}</p>
        ) : (
          <ul className="list contacts-list">
            {suggestions.map(({ id, name, numbers }) => (
              <li key={id} className="item">
                <div>
                  <p className="row-title">{name}</p>
                  {numbers.map((number) => <p className="row-meta number" key={number}>{number}</p>)}
                </div>
                <div className="actions">
                  <button type="button" className="btn btn-secondary btn-small" disabled={busy || result.loading}
                    aria-label={t("contacts.approveLabel", { name })}
                    onClick={() => void review({ action: "approve", id })}>
                    {t("contacts.approve")}
                  </button>
                  <button type="button" className="btn btn-secondary btn-small" disabled={busy || result.loading}
                    aria-label={t("contacts.rejectLabel", { name })}
                    onClick={() => void review({ action: "reject", id })}>
                    {t("contacts.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </LoadGate>
    </section>
  );
}
