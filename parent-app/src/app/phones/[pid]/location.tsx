// SPDX-License-Identifier: Apache-2.0
//
// Location, "Ring the phone" and "Are you okay?": the same sections and behaviour as the
// PWA's location page (web/src/pages/Location.tsx).
import { useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import { ApiError, client, unwrap } from "../../../api/client";
import { type AlwaysFor, type Checkin, type Contact, LOCATION_MODES, type LocationMode, type LocationState, type Position, type Ring } from "../../../api/models";
import { MapTiles } from "../../../components/MapTiles";
import { PhoneGate, usePhone } from "../../../components/PhoneContext";
import { AlwaysNotes, CheckinSection, RingSection } from "../../../components/safety";
import { Button, Card, Choice, errorMessage, LoadGate, type NoticeValue, PageTitle, Row, Screen, Stack as VStack, Text, useLoad, useNow } from "../../../components/ui";
import { useI18n } from "../../../i18n/I18n";
import { copyText } from "../../../lib/clipboard";
import { answers, FIND_TIMEOUT_MS, needsPolling, POLL_MS } from "../../../lib/location";
import { positionText, routeLinks } from "../../../lib/maps";
import { getItem, setItem } from "../../../lib/storage";
import { space } from "../../../lib/theme";
import { formatDateTime, formatMeters, formatRelative } from "../../../shared/lib/format";

const MAP_KEY = "pp.showMap"; // a display preference, not a credential

type Notify = (n: NoticeValue | null) => void;

/** The last known position: map, when, how accurate, and ways to get there. */
function PositionCard({ loc, name, now, notify }: { loc: Position; name: string; now: number; notify: Notify }) {
  const { t, locale } = useI18n();
  // Map tiles tell OpenStreetMap roughly where the phone is, so the map is opt-in.
  const [showMap, setShowMap] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void getItem(MAP_KEY).then((v) => setShowMap(v === "1")).catch(() => setShowMap(false));
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);
  function toggleMap() {
    const next = !showMap;
    setShowMap(next);
    void setItem(MAP_KEY, next ? "1" : "0").catch(() => undefined);
  }

  async function drive(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      notify({ tone: "error", text: t("error.generic") });
    }
  }

  async function copy() {
    try {
      // The share sheet has its own Copy action and says what happened; only the browser needs a note.
      if ((await copyText(positionText(loc.lat, loc.lon))) === "copied") {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      notify({ tone: "error", text: t("error.generic") });
    }
  }

  return (
    <Card testID="position-card">
      {showMap ? <MapTiles lat={loc.lat} lon={loc.lon} accuracyM={loc.accuracyM} label={t("loc.mapLabel", { name })} /> : null}
      <Text testID="position-meta">
        <Text style={{ fontWeight: "700" }}>{formatRelative(loc.recordedAt, now, locale)}</Text>
        <Text variant="muted"> · {formatDateTime(loc.recordedAt, locale)}</Text>
        {loc.accuracyM !== null ? <Text variant="muted"> · {t("loc.accuracyShort", { distance: formatMeters(loc.accuracyM, locale) })}</Text> : null}
      </Text>
      <VStack gap={space.sm}>
        <Text variant="label">{t("loc.driveThere")}</Text>
        <Row>
          {routeLinks(loc.lat, loc.lon, Platform.OS).map((l) => {
            const app = t(l.app === "apple" ? "loc.appleMaps" : "loc.googleMaps");
            return <Button key={l.app} testID={`route-${l.app}`} kind="secondary" title={`${app} ↗`} accessibilityLabel={app} onPress={() => void drive(l.url)} />;
          })}
          <Button
            testID="copy-position"
            kind="secondary"
            title={t(copied ? "loc.copied" : "loc.copy")}
            accessibilityHint={Platform.OS === "web" ? undefined : t("native.copyHint")}
            onPress={() => void copy()}
          />
        </Row>
      </VStack>
      {showMap === false ? <Text variant="small">{t("native.mapPrivacy")}</Text> : null}
      {showMap !== null ? (
        <Button testID="toggle-map" kind={showMap ? "plain" : "secondary"} title={t(showMap ? "native.hideMap" : "native.showMap")} onPress={toggleMap} />
      ) : null}
    </Card>
  );
}

function LocationBody() {
  const { t } = useI18n();
  const { phone, setPhone, notify } = usePhone();
  const now = useNow(1000);
  const res = useLoad(() => unwrap<LocationState>(client.GET("/phones/{pid}/location", { params: { path: { pid: phone.id } } })), [phone.id]);
  const contacts = useLoad(() => unwrap<{ contacts: Contact[] }>(client.GET("/phones/{pid}/contacts", { params: { path: { pid: phone.id } } })), [phone.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  // "Always on" was pressed and the parent is still choosing how long; nothing is sent before that.
  const [choosingAlways, setChoosingAlways] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  // Counts what the parent has pressed, so a poll that was answered before a press cannot undo it.
  const presses = useRef(0);
  const { setData } = res;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Keep the ring and the check-in fresh while something is open on the phone.
  const open = res.data ? needsPolling(res.data) : false;
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      const seen = presses.current;
      void unwrap<LocationState>(client.GET("/phones/{pid}/location", { params: { path: { pid: phone.id } } }))
        .then((r) => {
          if (alive.current && seen === presses.current) setData(() => r);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [open, phone.id, setData]);

  /** Runs one press: the server answers with what changed, which is merged into the screen. */
  async function act(key: string, fn: () => Promise<Partial<LocationState>>, success?: string) {
    presses.current++;
    setBusy(key);
    notify(null);
    try {
      const patch = await fn();
      presses.current++;
      setData((d) => (d ? { ...d, ...patch } : d));
      if (success) notify({ tone: "success", text: success });
    } catch (err) {
      notify({ tone: "error", text: errorMessage(err, t) });
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  /** `alwaysFor` goes with "always" only: the server refuses it without, and it always ends by itself. */
  async function setMode(mode: LocationMode, alwaysFor?: AlwaysFor) {
    await act(
      "mode",
      async () => {
        const body = mode === "always" && alwaysFor ? { mode, alwaysFor } : { mode };
        const r = await unwrap<LocationState>(client.PUT("/phones/{pid}/location/mode", { params: { path: { pid: phone.id } }, body }));
        setPhone({ ...phone, locationEnabled: mode !== "off", locationMode: mode });
        if (alive.current) setChoosingAlways(false);
        return r;
      },
      t(`loc.mode.${mode}.done`),
    );
  }

  function chooseMode(m: LocationMode, current: LocationMode) {
    // Pressing "always" asks how long first, also when it is on already (to extend it).
    setChoosingAlways(m === "always");
    if (m !== "always" && m !== current) void setMode(m);
  }

  async function find() {
    notify({ tone: "info", text: t("loc.finding") });
    setFinding(true);
    let requestedAt: string;
    try {
      requestedAt = (await unwrap<{ requestedAt: string }>(client.POST("/phones/{pid}/locate", { params: { path: { pid: phone.id } } }))).requestedAt;
    } catch (err) {
      setFinding(false);
      notify({ tone: "error", text: err instanceof ApiError && err.status === 409 ? t("loc.offBody") : errorMessage(err, t) });
      return;
    }
    const started = Date.now();
    const poll = async () => {
      try {
        const r = await unwrap<LocationState>(client.GET("/phones/{pid}/location", { params: { path: { pid: phone.id } } }));
        if (!alive.current) return;
        setData(() => r);
        if (answers(r.location, requestedAt)) {
          setFinding(false);
          notify({ tone: "success", text: t("loc.found") });
          return;
        }
      } catch {
        // keep trying until the timeout
      }
      if (!alive.current) return;
      if (Date.now() - started >= FIND_TIMEOUT_MS) {
        setFinding(false);
        notify({ tone: "error", text: t("loc.timeout") });
        return;
      }
      timer.current = setTimeout(() => void poll(), POLL_MS);
    };
    timer.current = setTimeout(() => void poll(), POLL_MS);
  }

  // The "Call me" choice waits for the contacts, so a quick press cannot send without the default.
  const contactsReady = contacts.data !== undefined || contacts.error !== null;

  return (
    <Screen
      testID="phone-location"
      onRefresh={() => {
        void res.reload();
        void contacts.reload();
      }}
      refreshing={res.loading && res.data !== undefined}
    >
      <PageTitle sub={t("loc.intro")}>{t("loc.title")}</PageTitle>
      <LoadGate res={res}>
        {(state) => (
          <>
            <VStack>
              <Text variant="heading">{t("loc.last")}</Text>
              {state.mode === "off" ? (
                <Card testID="location-off">
                  <Text variant="label">{t("loc.offTitle")}</Text>
                  <Text variant="muted">{t("loc.offBody")}</Text>
                </Card>
              ) : (
                <>
                  {state.location ? (
                    <PositionCard loc={state.location} name={phone.name} now={now} notify={notify} />
                  ) : (
                    <Text variant="muted">{t(state.mode === "always" ? "loc.none" : "loc.noneOnDemand")}</Text>
                  )}
                  <Button testID="location-find" title={finding ? t("loc.findingShort") : t("loc.find")} busy={finding} onPress={() => void find()} />
                </>
              )}
            </VStack>

            <RingSection
              ring={state.ring}
              now={now}
              busy={busy}
              onRing={(stopOnAnswer) =>
                void act("ring", async () => ({
                  ring: (await unwrap<{ ring: Ring }>(client.POST("/phones/{pid}/ring", { params: { path: { pid: phone.id } }, body: { stopOnAnswer } }))).ring,
                }))
              }
              onStop={() =>
                void act(
                  "ring-stop",
                  async () => ({ ring: (await unwrap<{ ring: Ring | null }>(client.DELETE("/phones/{pid}/ring", { params: { path: { pid: phone.id } } }))).ring }),
                  t("ring.stopped"),
                )
              }
            />

            <CheckinSection
              checkin={state.checkin}
              mode={state.mode}
              contacts={contacts.data?.contacts ?? []}
              ready={contactsReady}
              now={now}
              busy={busy}
              onSend={(minutes, callNumber) =>
                void act("checkin", async () => ({
                  checkin: (
                    await unwrap<{ checkin: Checkin }>(client.POST("/phones/{pid}/checkin", { params: { path: { pid: phone.id } }, body: { minutes, callNumber } }))
                  ).checkin,
                }))
              }
              onCancel={() =>
                void act(
                  "checkin-stop",
                  async () => ({
                    checkin: (await unwrap<{ checkin: Checkin | null }>(client.DELETE("/phones/{pid}/checkin", { params: { path: { pid: phone.id } } }))).checkin,
                  }),
                  t("checkin.cancelled"),
                )
              }
            />

            <Card testID="mode-section">
              <VStack gap={space.xs}>
                <Text variant="heading">{t("loc.mode.title")}</Text>
                <Text variant="muted">{t(phone.profile === "self" ? "loc.mode.introSelf" : "loc.mode.intro")}</Text>
              </VStack>
              <Choice<LocationMode>
                testID="location-mode"
                label={t("loc.mode.title")}
                hideLabel
                value={state.mode}
                disabled={busy === "mode"}
                onChange={(m) => chooseMode(m, state.mode)}
                options={LOCATION_MODES.map((m) => ({
                  value: m,
                  label: t(`loc.mode.${m}`),
                  help: t(m === "always" ? "native.alwaysHelp" : `loc.mode.${m}.help`),
                  testID: `mode-${m}`,
                }))}
              />
              {/* "Always" is the last option, so these notes sit right under it. */}
              <AlwaysNotes
                mode={state.mode}
                until={state.alwaysUntil}
                now={now}
                choosing={choosingAlways}
                busy={busy === "mode"}
                onStart={(alwaysFor) => void setMode("always", alwaysFor)}
                onCancel={() => setChoosingAlways(false)}
              />
            </Card>
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
