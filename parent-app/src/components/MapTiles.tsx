// SPDX-License-Identifier: Apache-2.0
//
// A small static map from OpenStreetMap raster tiles: a 3 by 3 grid of plain images
// centred on the position, with a marker and, when it is big enough to see, the
// accuracy circle. The zoom level follows the accuracy, so the circle is visible.
// No map SDK and no API key. The only third-party request is for the nine tiles
// (tile.openstreetmap.org sees the phone's IP address and the tiles asked for), and
// the attribution OpenStreetMap asks for is shown under the map.
import Constants from "expo-constants";
import { useState } from "react";
import { Image, Linking, Platform, Pressable, View } from "react-native";
import { useI18n } from "../i18n/I18n";
import { accuracyRadiusPx, tileGrid, TILE_SIZE, tileUrl, zoomForAccuracy } from "../lib/tiles";
import { radius, space, touch, useColors } from "../lib/theme";
import { Text } from "./ui";

export const MAP_HEIGHT = 280;
/** The accuracy circle gets at most this radius: it leaves room around it on a 280 px map. */
export const MAX_CIRCLE_PX = 100;
/** Three tiles cover at least 512 px across, so the map is never wider than that. */
export const MAP_MAX_WIDTH = TILE_SIZE * 2;
const MARKER = 26;
const DOT = 16;
/** Circles smaller than the marker, or bigger than the map, say nothing the text does not. */
const MIN_CIRCLE_PX = MARKER / 2 + 4;

/** OpenStreetMap asks apps to identify themselves in the User-Agent of tile requests. */
const USER_AGENT = `Plainphone-Parent/${Constants.expoConfig?.version ?? "0"} (https://plainphone.org)`;

function tileSource(zoom: number, x: number, y: number) {
  const uri = tileUrl(zoom, x, y);
  // Browsers do not let a page set the User-Agent.
  return Platform.OS === "web" ? { uri } : { uri, headers: { "User-Agent": USER_AGENT } };
}

export function MapTiles({ lat, lon, accuracyM, label }: { lat: number; lon: number; accuracyM: number | null; label: string }) {
  const { t } = useI18n();
  const c = useColors();
  const zoom = zoomForAccuracy(lat, accuracyM, MAX_CIRCLE_PX);
  const tiles = tileGrid(lat, lon, zoom);
  const circle = accuracyM === null ? 0 : accuracyRadiusPx(accuracyM, lat, zoom);
  const showCircle = circle >= MIN_CIRCLE_PX && circle <= MAP_HEIGHT / 2;
  // Tiles that did not load (offline, blocked). When none did, say so instead of showing an empty box.
  const [failed, setFailed] = useState<Record<string, true>>({});
  const tileKey = (x: number, y: number) => `${zoom}/${x}/${y}`;
  const allFailed = tiles.every((tile) => failed[tileKey(tile.x, tile.y)]);

  return (
    <View style={{ gap: space.xs }}>
      <View
        testID="map"
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={{
          height: MAP_HEIGHT,
          width: "100%",
          maxWidth: MAP_MAX_WIDTH,
          alignSelf: "center",
          overflow: "hidden",
          borderRadius: radius,
          borderWidth: 1,
          borderColor: c.line,
          backgroundColor: c.line,
        }}
      >
        {/* A zero-size anchor at the middle of the box: the position itself. */}
        <View style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0 }}>
          {tiles.map((tile) => (
            <Image
              key={tileKey(tile.x, tile.y)}
              testID="map-tile"
              accessible={false}
              importantForAccessibility="no"
              accessibilityIgnoresInvertColors
              source={tileSource(tile.zoom, tile.x, tile.y)}
              onError={() => setFailed((f) => ({ ...f, [tileKey(tile.x, tile.y)]: true }))}
              style={{ position: "absolute", left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
            />
          ))}
          {showCircle ? (
            <View
              testID="map-accuracy"
              style={{
                position: "absolute",
                left: -circle,
                top: -circle,
                width: circle * 2,
                height: circle * 2,
                borderRadius: circle,
                borderWidth: 2,
                borderColor: c.accent,
                backgroundColor: `${c.accent}33`,
              }}
            />
          ) : null}
          <View
            testID="map-marker"
            style={{
              position: "absolute",
              left: -MARKER / 2,
              top: -MARKER / 2,
              width: MARKER,
              height: MARKER,
              borderRadius: MARKER / 2,
              backgroundColor: c.onAccent,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: c.accent,
            }}
          >
            <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: c.accent }} />
          </View>
        </View>
      </View>
      {allFailed ? (
        <Text variant="small" accessibilityLiveRegion="polite">
          {t("loc.mapFailed")}
        </Text>
      ) : null}
      <Pressable
        onPress={() => void Linking.openURL("https://www.openstreetmap.org/copyright").catch(() => undefined)}
        accessibilityRole="link"
        accessibilityLabel={t("native.mapCredit")}
        style={{ minHeight: touch, justifyContent: "center", alignSelf: "center", maxWidth: MAP_MAX_WIDTH }}
      >
        <Text variant="small" style={{ textDecorationLine: "underline" }}>
          {t("native.mapCredit")}
        </Text>
      </Pressable>
    </View>
  );
}
