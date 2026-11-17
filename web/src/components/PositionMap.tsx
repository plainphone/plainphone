// SPDX-License-Identifier: Apache-2.0
//
// The phone's last position on a map. MapLibre GL and the tiles are loaded only when this
// component mounts (the location page), so no other page talks to the tile server.

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { circlePolygon, mapStyle, zoomFor } from "../lib/maps";

interface Props {
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** Accessible name, e.g. "Map: Alma's phone, accurate to about 20 m". */
  label: string;
  /** Shown if the map cannot load (offline, blocked, no WebGL). */
  fallback: string;
}

const prefersDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
const accent = (dark: boolean) => (dark ? "#7fc4a2" : "#24604a");

function circle(lat: number, lon: number, accuracyM: number | null) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [circlePolygon(lat, lon, Math.max(accuracyM ?? 0, 5))] },
  };
}

export function PositionMap({ lat, lon, accuracyM, label, fallback }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<{ setLngLat: (p: [number, number]) => unknown } | null>(null);
  const [failed, setFailed] = useState(false);
  const pos = useRef({ lat, lon, accuracyM });
  pos.current = { lat, lon, accuracyM };

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void (async () => {
      try {
        const [maplibregl, worker] = await Promise.all([
          import("maplibre-gl"),
          // Bundled by Vite as its own file, so it loads under the CSP's worker-src 'self'.
          import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        maplibregl.setWorkerUrl(worker.default);
        if (cancelled || !box.current) return;
        const dark = prefersDark();
        const { lat: la, lon: lo, accuracyM: acc } = pos.current;
        const m = new maplibregl.Map({
          container: box.current,
          style: mapStyle(dark),
          center: [lo, la],
          zoom: zoomFor(la, acc, box.current.clientWidth || 600),
          attributionControl: { compact: true },
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
        });
        m.touchZoomRotate.disableRotation();
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        const dot = document.createElement("div");
        dot.className = "map-dot";
        marker.current = new maplibregl.Marker({ element: dot }).setLngLat([lo, la]).addTo(m);
        m.on("load", () => {
          const p = pos.current;
          m.addSource("accuracy", { type: "geojson", data: circle(p.lat, p.lon, p.accuracyM) });
          m.addLayer({ id: "accuracy-fill", type: "fill", source: "accuracy", paint: { "fill-color": accent(dark), "fill-opacity": 0.14 } });
          m.addLayer({
            id: "accuracy-line",
            type: "line",
            source: "accuracy",
            paint: { "line-color": accent(dark), "line-width": 1.5, "line-opacity": 0.6 },
          });
        });
        m.on("error", (e: { error?: { message?: string } }) => {
          // A missing tile is fine; a style that cannot load means no map at all.
          if (!m.isStyleLoaded() && /style|Failed to fetch|NetworkError/i.test(String(e.error?.message ?? ""))) setFailed(true);
        });
        map.current = m;
        dispose = () => m.remove();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
      map.current = null;
    };
  }, []);

  // Move the marker and circle when a new position arrives.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    marker.current?.setLngLat([lon, lat]);
    const src = m.getSource("accuracy") as { setData?: (d: unknown) => void } | undefined;
    src?.setData?.(circle(lat, lon, accuracyM));
    m.easeTo({ center: [lon, lat], zoom: zoomFor(lat, accuracyM, box.current?.clientWidth || 600), duration: 600 });
  }, [lat, lon, accuracyM]);

  if (failed) return <p className="map map-fallback">{fallback}</p>;
  return <div ref={box} className="map" role="region" aria-label={label} />;
}
