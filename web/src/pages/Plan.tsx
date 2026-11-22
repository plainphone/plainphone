// SPDX-License-Identifier: Apache-2.0
//
// The household's hosted plan (docs/billing.md). Only reachable while the server has billing on;
// with billing off the page sends the user back to Settings and nothing about money shows anywhere.
// Prices come from the server, never from the copy.

import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { errorNotice, LiveStatus, LoadGate, type Notice, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api } from "../lib/api";
import { formatPrice, type Plan, planNowKey, usageText } from "@plainphone/shared/billing";
import { intlLocale } from "@plainphone/shared/format";
import { useMe } from "../lib/session";
import "../components/billing.css";

/** The household's plan, or null while loading, on an old server or with any error (= no billing UI). */
export function usePlan(): Plan | null {
  const me = useMe();
  const hid = me.households[0]?.id;
  const res = useLoad(() => (hid ? api.get<Plan>(`/households/${hid}/plan`) : Promise.resolve(null)), [hid]);
  return res.data ?? null;
}

export function PlanPage() {
  const me = useMe();
  const hid = me.households[0]?.id;
  const res = useLoad(() => (hid ? api.get<Plan>(`/households/${hid}/plan`) : Promise.resolve(null)), [hid]);
  if (!hid) return <Navigate to="/settings" replace />;
  return (
    <div className="narrow">
      <LoadGate res={res}>
        {(plan) => (plan?.billing ? <PlanView hid={hid} plan={plan} /> : <Navigate to="/settings" replace />)}
      </LoadGate>
    </div>
  );
}

function PlanView({ hid, plan }: { hid: string; plan: Plan }) {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(
    params.get("checkout") === "done" ? { tone: "success", text: t("plan.checkoutDone") } : null,
  );
  const [busy, setBusy] = useState(false);
  const now = planNowKey(plan);
  const price = formatPrice(plan.prices.plus, plan.prices.currency, locale);
  const until = plan.until ? new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long" }).format(new Date(plan.until)) : null;

  async function go(path: "checkout" | "portal") {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ url: string }>(`/households/${hid}/plan/${path}`);
      window.location.assign(r.url);
    } catch (err) {
      setNotice(errorNotice(err, t));
      setBusy(false);
    }
  }

  return (
    <>
      <p className="back">
        <Link to="/settings">{t("nav.settings")}</Link>
      </p>
      <PageTitle sub={t("plan.intro")}>{t("plan.title")}</PageTitle>
      <LiveStatus notice={notice} onClose={() => setNotice(null)} />

      <section className="section panel stack-sm" aria-labelledby="plan-now-h">
        <h2 id="plan-now-h" className="sr-only">{t("plan.title")}</h2>
        {now && <p className="row-title">{t(now)}</p>}
        {plan.plan === "grandfathered" && <p>{t("plan.grandfathered")}</p>}
        {plan.plan === "plus" && until && <p className="help">{t("plan.until", { date: until })}</p>}
        {plan.plan === "plus" && plan.source === "play" && <p className="help">{t("plan.play")}</p>}
        <h3>{t("plan.usage")}</h3>
        <dl className="plan-usage">
          <dt>{t("plan.usage.phones")}</dt>
          <dd>{usageText(plan.usage.phones, plan.limits.phones, t)}</dd>
          <dt>{t("plan.usage.trusted")}</dt>
          <dd>{usageText(plan.usage.trusted, plan.limits.trusted, t)}</dd>
        </dl>
        {plan.canManage && plan.source !== "play" && (
          <div>
            <button type="button" className="btn btn-secondary" onClick={() => void go("portal")} disabled={busy}>
              {t("plan.manage")}
            </button>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="plan-free-h">
        <h2 id="plan-free-h">{t("plan.freeTitle")}</h2>
        <ul className="plan-list">
          <li>{t("plan.freeOne")}</li>
          <li>{t("plan.freeNever")}</li>
        </ul>
      </section>

      {plan.plan === "free" && (
        <section className="section" aria-labelledby="plan-plus-h">
          <h2 id="plan-plus-h">{t("plan.plusTitle")}</h2>
          <ul className="plan-list">
            <li>{t("plan.plusPhones")}</li>
            <li>{t("plan.plusTrusted")}</li>
            <li>{t("plan.plusSupport")}</li>
          </ul>
          <p className="help">{t("plan.price", { price })}</p>
          {plan.channels.stripe && (
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={() => void go("checkout")} disabled={busy}>
                {busy ? t("plan.opening") : t("plan.upgrade")}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
