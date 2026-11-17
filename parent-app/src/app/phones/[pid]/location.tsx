// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import type { LocationState, Phone } from "../../../api/models";
import { MapTiles } from "../../../components/MapTiles";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { Button, Card, errorMessage, List, LiveStatus, LoadGate, type NoticeValue, PageTitle, Screen, Section, Stack as VStack, Switch, Text, useLoad, useNow } from "../../../components/ui";
import { space } from "../../../lib/theme";
import { useI18n } from "../../../i18n/I18n";
import { answers, FIND_TIMEOUT_MS, POLL_MS } from "../../../lib/location";
import { mapsUrl } from "../../../lib/maps";
import { getItem, setItem } from "../../../lib/storage";
import { formatCoord, formatDateTime, formatMeters, formatRelative, osmUrl } from "../../../shared/lib/format";

type Fix = NonNullable<LocationState["location"]>;

const MAP_KEY = "pp.showMap"; // a display preference, not a credential

/** The last known position: map, when, how accurate, and a way to open it in a maps app. */
function Position({ location, name, now, onError }: { location: Fix; name: string; now: number; onError: (text: string) => void }) {
  const { t, locale } = useI18n();
  // Map tiles tell OpenStreetMap roughly where the phone is, so the map is opt-in.
  const [showMap, setShowMap] = useState<boolean | null>(null);
  useEffect(() => {
    void getItem(MAP_KEY).then((v) => setShowMap(v === "1")).catch(() => setShowMap(false));
  }, []);
  function toggleMap() {
    const next = !showMap;
    setShowMap(next);
    void setItem(MAP_KEY, next ? "1" : "0").catch(() => undefined);
  }

  async function openInMaps() {
    try {
      await Linking.openURL(mapsUrl(Platform.OS, location.lat, location.lon, name));
    } catch {
      // No maps app handles the link (geo: on some Android builds): the web map always works.
      try {
        await Linking.openURL(osmUrl(location.lat, location.lon));
      } catch {
        onError(t("error.generic"));
      }
    }
  }

  return (
    <Card>
      {showMap ? <MapTiles lat={location.lat} lon={location.lon} accuracyM={location.accuracyM} /> : null}
      <VStack gap={2}>
        <Text variant="row">
          {t("loc.at", { time: formatDateTime(location.recordedAt, locale), ago: formatRelative(location.recordedAt, now, locale) })}
        </Text>
        {location.accuracyM !== null ? <Text variant="small">{t("loc.accuracy", { distance: formatMeters(location.accuracyM, locale) })}</Text> : null}
        <Text variant="small" selectable>
          {t("loc.coords")}: {formatCoord(location.lat, locale)}, {formatCoord(location.lon, locale)}
        </Text>
      </VStack>
      <Button
        testID="open-in-maps"
        kind="secondary"
        title={t(Platform.OS === "web" ? "loc.openMap" : "native.openInMaps")}
        onPress={() => void openInMaps()}
      />
      {showMap === false ? <Text variant="small">{t("native.mapPrivacy")}</Text> : null}
      {showMap !== null ? (
        <Button testID="toggle-map" kind="plain" title={t(showMap ? "native.hideMap" : "native.showMap")} onPress={toggleMap} />
      ) : null}
    </Card>
  );
}

function LocationBody() {
  const { t } = useI18n();
  const { phone, setPhone } = usePhone();
  const now = useNow(30_000);
  const res = useLoad(() => unwrap<LocationState>(client.GET("/phones/{pid}/location", { params: { path: { pid: phone.id } } })), [phone.id]);
  const [notice, setNotice] = useState<NoticeValue | null>(null);
  const [toggling, setToggling] = useState(false);
  const [finding, setFinding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function setEnabled(enabled: boolean) {
    setToggling(true);
    setNotice(null);
    try {
      const p = await unwrap<Phone>(client.PATCH("/phones/{pid}", { params: { path: { pid: phone.id } }, body: { locationEnabled: enabled } }));
      setPhone(p);
      await res.reload();
      setNotice({ tone: "success", text: t(enabled ? "loc.turnedOn" : "loc.turnedOff") });
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err, t) });
    } finally {
      setToggling(false);
    }
  }

  async function find() {
    setNotice({ tone: "info", text: t("loc.finding") });
    setFinding(true);
    let requestedAt: string;
    try {
      requestedAt = (await unwrap<{ requestedAt: string }>(client.POST("/phones/{pid}/locate", { params: { path: { pid: phone.id } } }))).requestedAt;
    } catch (err) {
      setFinding(false);
      setNotice({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("loc.offBody") : errorMessage(err, t) });
      return;
    }
    const started = Date.now();
    const poll = async () => {
      try {
        const r = await unwrap<LocationState>(client.GET("/phones/{pid}/location", { params: { path: { pid: phone.id } } }));
        if (!alive.current) return;
        res.setData(() => r);
        if (answers(r.location, requestedAt)) {
          setFinding(false);
          setNotice({ tone: "success", text: t("loc.found") });
          return;
        }
      } catch {
        // keep trying until the timeout
      }
      if (!alive.current) return;
      if (Date.now() - started >= FIND_TIMEOUT_MS) {
        setFinding(false);
        setNotice({ tone: "error", text: t("loc.timeout") });
        return;
      }
      timer.current = setTimeout(() => void poll(), POLL_MS);
    };
    timer.current = setTimeout(() => void poll(), POLL_MS);
  }

  return (
    <Screen testID="phone-location" onRefresh={() => void res.reload()} refreshing={res.loading && res.data !== undefined}>
      <PageTitle sub={t("loc.intro")}>{t("loc.title")}</PageTitle>
      <LoadGate res={res}>
        {(state) => (
          <>
            <List>
              <Switch
                testID="location-switch"
                label={t("loc.switch")}
                help={t("loc.switchHelp")}
                value={state.enabled}
                disabled={toggling}
                onValueChange={(v) => void setEnabled(v)}
              />
            </List>
            <LiveStatus notice={notice} onClose={() => setNotice(null)} />
            {!state.enabled ? (
              <Section title={t("loc.offTitle")}>
                <Text style={{ paddingHorizontal: space.xs }}>{t("loc.offBody")}</Text>
              </Section>
            ) : (
              <Section title={t("loc.last")}>
                {state.location ? (
                  <Position location={state.location} name={phone.name} now={now} onError={(text) => setNotice({ tone: "error", text })} />
                ) : (
                  <Text variant="muted" style={{ paddingHorizontal: space.xs }}>{t("loc.none")}</Text>
                )}
                <View style={{ marginTop: space.sm }}>
                  <Button testID="location-find" title={finding ? t("loc.finding") : t("loc.find")} busy={finding} onPress={() => void find()} />
                </View>
              </Section>
            )}
          </>
        )}
      </LoadGate>
    </Screen>
  );
}

export default function LocationScreen() {
  return (
    <PhoneGate>
      <LocationBody />
    </PhoneGate>
  );
}
