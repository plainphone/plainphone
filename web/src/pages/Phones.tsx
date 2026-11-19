// SPDX-License-Identifier: Apache-2.0
import { SosPanel } from "../components/SosPanel";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { LiveStatus, LoadGate, type Notice, PageTitle, useLoad, useNow } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, type PendingChange, type Phone } from "../lib/api";
import { formatRelative } from "../lib/format";
import { helpUrl, releaseState } from "../lib/phoneSupport";

interface Row {
  phone: Phone;
  pending: number;
}

export function PhonesPage() {
  const { t, locale } = useI18n();
  const now = useNow(60_000);
  // A note handed over by the page that sent us here, such as "The phone was removed."
  const loc = useLocation();
  const navigate = useNavigate();
  const handed = (loc.state as { notice?: string } | null)?.notice;
  const [notice, setNotice] = useState<Notice | null>(handed ? { tone: "success", text: handed } : null);
  // Shown once: not again after a reload or going back.
  useEffect(() => {
    if (handed) navigate(".", { replace: true, state: null });
  }, [handed, navigate]);
  const res = useLoad(async (): Promise<Row[]> => {
    const { phones } = await api.get<{ phones: Phone[] }>("/phones");
    return Promise.all(
      phones.map(async (phone) => {
        if (phone.profile !== "self") return { phone, pending: 0 };
        try {
          const r = await api.get<{ changes: PendingChange[] }>(`/phones/${phone.id}/changes`);
          return { phone, pending: r.changes.length };
        } catch {
          return { phone, pending: 0 };
        }
      }),
    );
  }, []);

  return (
    <>
      <div className="title-row phones-heading">
        <PageTitle>{t("phones.title")}</PageTitle>
        {res.data && res.data.length > 0 && (
          <Link to="/add" className="btn btn-primary">
            {t("phones.add")}
          </Link>
        )}
      </div>
      {res.data?.filter(({ phone }) => phone.profile === "child" && phone.pairedAt).map(({ phone }) => (
        <SosPanel key={phone.id} pid={phone.id} phoneName={phone.name} />
      ))}
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      <LoadGate res={res}>
        {(rows) =>
          rows.length === 0 ? (
            <section className="empty" aria-labelledby="empty-title">
              <PhoneDrawing />
              <h2 id="empty-title">{t("phones.emptyTitle")}</h2>
              <p>{t("phones.emptyBody")}</p>
              <p>
                <Link to="/add" className="btn btn-primary">
                  {t("phones.add")}
                </Link>
              </p>
            </section>
          ) : (
            <ul className="list phone-list">
              {rows.map(({ phone, pending }) => (
                <li key={phone.id}>
                  <Link to={`/phones/${phone.id}`} className="row-link">
                    <span className="row-main">
                      <span className="row-title">{phone.name}</span>
                      <span className="row-meta">
                        <span className={`tag tag-${phone.profile}`}>{t(phone.profile === "child" ? "profile.child" : "profile.self")}</span>
                        {phone.mode === "light" && <span className="tag">{t("mode.light")}</span>}
                        {!phone.pairedAt && <span className="tag tag-waiting">{t("phones.notSetUp")}</span>}
                        {phone.status?.lockIntact === false && <span className="tag tag-alert">{t("phones.lockBroken")}</span>}
                        {phone.pairedAt && (
                          <span>
                            {phone.lastSeenAt
                              ? t("phones.lastSeen", { when: formatRelative(phone.lastSeenAt, now, locale) })
                              : t("phones.neverSeen")}
                          </span>
                        )}
                      </span>
                      <PhoneReleaseLabel phone={phone} />
                      {pending > 0 && (
                        <span className="row-pending">
                          {t(pending === 1 ? "phones.pendingCount" : "phones.pendingCountMany", { n: pending })}
                        </span>
                      )}
                    </span>
                    {phone.openRequests > 0 && (
                      <span className="count-badge">
                        <span aria-hidden="true">{phone.openRequests}</span>
                        <span className="sr-only">
                          {t(phone.openRequests === 1 ? "phones.requestCount" : "phones.requestCountMany", { n: phone.openRequests })}
                        </span>
                      </span>
                    )}
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </LoadGate>
      <p className="muted"><a href={helpUrl(locale)}>{t("support.openHelp")}</a></p>
    </>
  );
}

export function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 5l7 7-7 7" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneReleaseLabel({ phone }: { phone: Phone }) {
  const { t } = useI18n();
  const state = releaseState(phone);
  if (!state) return null;
  if (state === "requested") return <span className="row-pending">{t("phone.releasingTag")}</span>;
  return <span className="row-pending">{t(state === "old" ? "support.releaseOld" : "support.releaseStalled")}</span>;
}

function PhoneDrawing() {
  return (
    <svg className="empty-art" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect x="38" y="14" width="44" height="92" rx="10" fill="none" strokeWidth="3" />
      <rect x="49" y="44" width="22" height="22" rx="3" fill="none" strokeWidth="3" />
      <path d="M54 49h4v4h-4zM62 57h4v4h-4zM54 57h4v4h-4z" />
      <path d="M50 80h20" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
