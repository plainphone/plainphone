// SPDX-License-Identifier: Apache-2.0
//
// Map tiles and route links for the location page. No API keys: tiles come from OpenFreeMap
// (OpenStreetMap data), and "Drive there" hands the position to the parent's own maps app.

/** The only third party the map talks to. Also listed in the server's CSP and in docs/privacy.md. */
export const TILE_ORIGIN = "https://tiles.openfreemap.org";

export function mapStyle(dark: boolean): string {
  return `${TILE_ORIGIN}/styles/${dark ? "dark" : "positron"}`;
}

const fixed = (n: number) => n.toFixed(6);

export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${fixed(lat)},${fixed(lon)}`;
}

export function appleMapsUrl(lat: number, lon: number): string {
  return `https://maps.apple.com/?daddr=${fixed(lat)},${fixed(lon)}`;
}

/** iPhone, iPad (also iPadOS that says it is a Mac) and iPod. */
export function isAppleMobile(ua: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export type RouteApp = "apple" | "google";

/** Route links, Apple Maps first on Apple devices. */
export function routeLinks(lat: number, lon: number, apple: boolean): { app: RouteApp; url: string }[] {
  const links = [
    { app: "google" as const, url: googleMapsUrl(lat, lon) },
    { app: "apple" as const, url: appleMapsUrl(lat, lon) },
  ];
  return apple ? links.reverse() : links;
}

/** "55.676098, 12.568337": what "Copy position" puts on the clipboard; maps apps understand it. */
export function positionText(lat: number, lon: number): string {
  return `${fixed(lat)}, ${fixed(lon)}`;
}

/** A circle of `radiusM` metres around a point, as a GeoJSON ring (good enough below a few km). */
export function circlePolygon(lat: number, lon: number, radiusM: number, steps = 64): [number, number][] {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

/** A zoom level that shows the accuracy circle with some room around it. */
export function zoomFor(lat: number, accuracyM: number | null, widthPx = 600): number {
  const r = Math.max(accuracyM ?? 50, 30);
  // Metres per pixel at zoom z: 156543 * cos(lat) / 2^z. Fit the diameter into ~60 % of the width.
  const z = Math.log2((156_543 * Math.cos((lat * Math.PI) / 180) * widthPx * 0.6) / (2 * r));
  return Math.max(3, Math.min(17, z));
}
