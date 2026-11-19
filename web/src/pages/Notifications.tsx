// SPDX-License-Identifier: Apache-2.0
//
// Settings → Notifications: switch them on for this device, test, and choose per phone.

import { useEffect, useState } from "react";
import { errorMessage, LiveStatus, type Notice, Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, type NotificationSettings, type Phone } from "../lib/api";
import { currentEndpoint, disablePush, enablePush, PermissionDenied, PUSH_ID_KEY as DEVICE_KEY, pushSupport, sha256Hex } from "../lib/push";
const HOURS = [1, 3, 6, 12, 24, 48];

export function NotificationsSection() {
  const { t } = useI18n();
  const res = useLoad(
    async () => {
      const [settings, { phones }] = await Promise.all([
        api.get<NotificationSettings>("/notifications"),
        api.get<{ phones: Phone[] }>("/phones"),
      ]);
      return { settings, phones };
    },
    [],
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [thisId, setThisId] = useState<string | null>(null);
  const support = pushSupport();
  const blocked = support === "ok" && Notification.permission === "denied";

  // This device is on when the browser has a subscription and the server still knows it.
  const data = res.data;
  useEffect(() => {
    if (!data) return;
    // This device is the row whose endpoint matches the browser's subscription. Never
    // register on its own: a device removed elsewhere stays removed until someone taps.
    void currentEndpoint().then(async (ep) => {
      const hash = ep ? await sha256Hex(ep) : null;
      const mine = hash ? data.settings.subscriptions.find((s) => s.endpointHash === hash) : undefined;
      if (mine) localStorage.setItem(DEVICE_KEY, mine.id);
      else localStorage.removeItem(DEVICE_KEY);
      setThisId(mine?.id ?? null);
    }).catch(() => setThisId(null));
  }, [data]);

  if (!data) return null;
  const { settings, phones } = data;
  const others = settings.subscriptions.filter((s) => s.id !== thisId);

  async function turnOn() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await enablePush(settings.webPushPublicKey!);
      localStorage.setItem(DEVICE_KEY, r.id);
      setThisId(r.id);
      await res.reload();
      setNotice({ tone: "success", text: t("notif.turnedOn") });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof PermissionDenied ? t("notif.denied") : errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(id: string | null) {
    setBusy(true);
    setNotice(null);
    try {
      if (id === thisId) {
        await disablePush(thisId);
        localStorage.removeItem(DEVICE_KEY);
        setThisId(null);
      } else if (id) {
        await api.del(`/notifications/subscriptions/${id}`);
      }
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function test(id: string | null) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ sent: number }>("/notifications/test", { subscriptionId: id ?? undefined });
      setNotice(r.sent > 0 ? { tone: "success", text: t("notif.testSent") } : { tone: "error", text: t("notif.testFailed") });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function setMuted(phoneId: string, enabled: boolean) {
    try {
      await api.put(`/phones/${phoneId}/notifications`, { enabled });
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    }
  }

  async function setHours(phoneId: string, value: string) {
    try {
      await api.patch(`/phones/${phoneId}`, { offlineAlertHours: value === "" ? null : Number(value) });
      await res.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    }
  }

  return (
    <section className="section" aria-labelledby="notif-h">
      <h2 id="notif-h">{t("notif.title")}</h2>
      <p className="muted">{t("notif.intro")}</p>

      <div className="notif-device">
        {!settings.webPushEnabled ? (
          <p className="notice notice-info">{t("notif.serverOff")}</p>
        ) : support === "ios-install" ? (
          <div className="notice notice-info">
            <p className="row-title">{t("notif.iosTitle")}</p>
            <ol className="plain-list">
              <li>{t("notif.ios1")}</li>
              <li>{t("notif.ios2")}</li>
              <li>{t("notif.ios3")}</li>
            </ol>
          </div>
        ) : support === "none" ? (
          <p className="notice notice-info">{t("notif.unsupported")}</p>
        ) : blocked && !thisId ? (
          <p className="notice notice-warn">{t("notif.denied")}</p>
        ) : thisId ? (
          <>
            <p>{t("notif.onHere")}</p>
            <div className="actions">
              <button type="button" className="btn btn-secondary" onClick={() => void test(thisId)} disabled={busy}>
                {t("notif.test")}
              </button>
              <button type="button" className="btn-link" onClick={() => void turnOff(thisId)} disabled={busy}>
                {t("notif.turnOff")}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void turnOn()} disabled={busy}>
            {t("notif.turnOn")}
          </button>
        )}
        <LiveStatus notice={notice} onClose={() => setNotice(null)} />
      </div>

      {others.length > 0 && (
        <>
          <h3 className="h-small">{t("notif.otherDevices")}</h3>
          <ul className="list item-list">
            {others.map((s) => (
              <li key={s.id} className="item">
                <p className="row-title">{s.label ?? (s.platform === "apns" ? "iOS" : s.platform === "fcm" ? "Android" : t("notif.unknownDevice"))}</p>
                <div className="actions">
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => void test(s.id)} disabled={busy}>
                    {t("notif.test")}
                  </button>
                  <button type="button" className="btn btn-secondary btn-small" onClick={() => void turnOff(s.id)} disabled={busy}>
                    {t("app.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {phones.length > 0 && (
        <>
          <h3 className="h-small">{t("notif.phones")}</h3>
          <ul className="list notif-phones">
            {phones.map((p) => {
              const on = !settings.mutedPhoneIds.includes(p.id);
              return (
                <li key={p.id} className="notif-phone">
                  <Switch checked={on} onChange={(v) => void setMuted(p.id, v)} label={p.name} />
                  {on && (
                    <label className="inline-select">
                      <span>{t("notif.quietAfter")}</span>
                      <select value={p.offlineAlertHours ?? ""} onChange={(e) => void setHours(p.id, e.target.value)}>
                        <option value="">
                          {p.offlineAlertHoursDefault === 0
                            ? t("notif.neverDefault")
                            : t("notif.hoursDefault", { n: p.offlineAlertHoursDefault })}
                        </option>
                        {HOURS.filter((h) => h !== p.offlineAlertHoursDefault).map((h) => (
                          <option key={h} value={h}>
                            {t(h === 1 ? "notif.hour" : "notif.hours", { n: h })}
                          </option>
                        ))}
                        {p.offlineAlertHoursDefault !== 0 && <option value="0">{t("notif.never")}</option>}
                      </select>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="help">{t("notif.mailToo")}</p>
        </>
      )}
    </section>
  );
}
