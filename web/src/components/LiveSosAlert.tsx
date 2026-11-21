// SPDX-License-Identifier: Apache-2.0
//
// An SOS shows at once, on any page, with an alarm tone if this device has it switched on.
// The event only carries ids: what is shown comes from the normal API.

import { useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useI18n } from "../i18n/I18n";
import { api, type Phone } from "../lib/api";
import { playSosTone } from "../lib/alarm";
import { useLiveEvent } from "../lib/live";
import { readLiveSetting, SOS_SOUND_KEY } from "../lib/live-settings";

interface Alert {
  phoneId: string;
  name: string;
  urgent: boolean;
  ids: string[];
}

export function LiveSosAlert() {
  const { t } = useI18n();
  const loc = useLocation();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // One tone per SOS, however many times it is fetched; a dismissed one stays dismissed.
  const sounded = useRef(new Set<string>());
  const dismissed = useRef(new Set<string>());
  const names = useRef(new Map<string, string>());
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  useLiveEvent(["sos.created", "sos.updated"], undefined, (e) => {
    void (async () => {
      try {
        const { events } = await api.get<{ events: { id: string; kind: string }[] }>(`/phones/${e.phoneId}/sos?unseen=1`);
        const open = events.filter((ev) => !dismissed.current.has(ev.id));
        // Another parent saw it: take the banner down.
        if (!open.length) {
          setAlerts((all) => all.filter((a) => a.phoneId !== e.phoneId));
          return;
        }
        // An update only refreshes a banner that is already there.
        if (e.type === "sos.updated" && !alertsRef.current.some((a) => a.phoneId === e.phoneId)) return;
        if (e.type === "sos.created") {
          const fresh = open.filter((ev) => !sounded.current.has(ev.id));
          fresh.forEach((ev) => sounded.current.add(ev.id));
          if (fresh.length && readLiveSetting(SOS_SOUND_KEY)) playSosTone();
        }
        let name = names.current.get(e.phoneId);
        if (name === undefined) {
          name = await api.get<Phone>(`/phones/${e.phoneId}`).then((p) => p.name, () => "");
          names.current.set(e.phoneId, name);
        }
        const next: Alert = { phoneId: e.phoneId, name, urgent: open.some((ev) => ev.kind === "urgent"), ids: open.map((ev) => ev.id) };
        setAlerts((all) => [...all.filter((a) => a.phoneId !== e.phoneId), next]);
      } catch {
        // The phone page and the SOS panel poll too; nothing to say here.
      }
    })();
  });

  // The overview of that phone, and the dashboard, already show it in their SOS panel.
  const here = loc.pathname.replace(/\/$/, "") || "/";
  const shown = alerts.filter((a) => here !== "/" && here !== `/phones/${a.phoneId}`);
  if (!shown.length) return null;
  return (
    <div className="wrap live-sos stack">
      {shown.map((a) => (
        <div key={a.phoneId} className="sos-alert stack" data-kind={a.urgent ? "urgent" : "help"} role="alert" tabIndex={-1}>
          <div className="sos-event-heading">
            {a.name && <strong>{a.name}</strong>}
            <strong>{t(a.urgent ? "sos.urgent" : "sos.help")}</strong>
          </div>
          <div className="actions">
            <Link className="btn btn-primary" to={`/phones/${a.phoneId}`}>{t("live.sosOpen")}</Link>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                a.ids.forEach((id) => dismissed.current.add(id));
                setAlerts((all) => all.filter((x) => x.phoneId !== a.phoneId));
              }}
            >
              {t("live.sosDismiss")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
