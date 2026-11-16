// SPDX-License-Identifier: Apache-2.0
//
// Where "Open in Maps" leads: Apple Maps on iOS, whatever handles geo: links on Android
// (Google Maps and others), OpenStreetMap on the web.
import { osmUrl } from "../shared/lib/format";

export function mapsUrl(os: string, lat: number, lon: number, label: string): string {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (os === "ios") return `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(label)}`;
  if (os === "android") return `geo:${ll}?q=${ll}`;
  return osmUrl(lat, lon);
}
