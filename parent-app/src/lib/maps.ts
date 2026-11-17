// SPDX-License-Identifier: Apache-2.0
//
// "Drive there": the position handed to the parent's own maps app. Same links as the PWA
// (web/src/lib/maps.ts), Apple Maps first on iOS.

const fixed = (n: number) => n.toFixed(6);

export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${fixed(lat)},${fixed(lon)}`;
}

export function appleMapsUrl(lat: number, lon: number): string {
  return `https://maps.apple.com/?daddr=${fixed(lat)},${fixed(lon)}`;
}

export type RouteApp = "apple" | "google";

/** Route links for the platform (`Platform.OS`): Apple Maps first on iOS, Google Maps first elsewhere. */
export function routeLinks(lat: number, lon: number, os: string): { app: RouteApp; url: string }[] {
  const links = [
    { app: "google" as const, url: googleMapsUrl(lat, lon) },
    { app: "apple" as const, url: appleMapsUrl(lat, lon) },
  ];
  return os === "ios" ? links.reverse() : links;
}

/** "55.676098, 12.568337": what "Copy position" hands over; maps apps understand it. */
export function positionText(lat: number, lon: number): string {
  return `${fixed(lat)}, ${fixed(lon)}`;
}
