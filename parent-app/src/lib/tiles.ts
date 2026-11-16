// SPDX-License-Identifier: Apache-2.0
//
// Slippy-map tile maths for the static OpenStreetMap view (components/MapTiles.tsx).
// Pure functions, so they can be tested without a renderer.
// https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames

export const TILE_SIZE = 256;
/** Web Mercator stops at this latitude. */
export const MAX_LATITUDE = 85.0511287798;
/** Metres per pixel at the equator on zoom 0 (Earth's circumference / 256). */
const EQUATOR_M_PER_PX = 156_543.03392804097;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Longitude folded into [-180, 180). */
export function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export interface TilePoint {
  /** Tile column and row on this zoom level. */
  x: number;
  y: number;
  /** Where the position falls inside that tile, in pixels (0 to 256, from the top left). */
  offsetX: number;
  offsetY: number;
}

/** The tile that holds a position, and the pixel offset of the position inside it. */
export function tileForPosition(lat: number, lon: number, zoom: number): TilePoint {
  const n = 2 ** zoom;
  const latRad = (clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180;
  const fx = ((wrapLongitude(lon) + 180) / 360) * n;
  const fy = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;
  const x = clamp(Math.floor(fx), 0, n - 1);
  const y = clamp(Math.floor(fy), 0, n - 1);
  return { x, y, offsetX: (fx - x) * TILE_SIZE, offsetY: (fy - y) * TILE_SIZE };
}

export interface PlacedTile {
  zoom: number;
  x: number;
  y: number;
  /** Pixel position of the tile's top left corner relative to the position itself. */
  left: number;
  /** See left. */
  top: number;
}

/**
 * The (2 * radius + 1) squared tiles around a position (3 by 3 for the default radius),
 * each placed relative to the position. Tile columns wrap around the date line; rows
 * beyond the poles are left out.
 */
export function tileGrid(lat: number, lon: number, zoom: number, radius = 1): PlacedTile[] {
  const n = 2 ** zoom;
  const c = tileForPosition(lat, lon, zoom);
  const tiles: PlacedTile[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    const y = c.y + dy;
    if (y < 0 || y >= n) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      tiles.push({
        zoom,
        x: (((c.x + dx) % n) + n) % n,
        y,
        left: dx * TILE_SIZE - c.offsetX,
        top: dy * TILE_SIZE - c.offsetY,
      });
    }
  }
  return tiles;
}

export function tileUrl(zoom: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

/** Ground resolution at a latitude and zoom level. */
export function metersPerPixel(lat: number, zoom: number): number {
  const latRad = (clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180;
  return (EQUATOR_M_PER_PX * Math.cos(latRad)) / 2 ** zoom;
}

/** The radius of an accuracy circle in map pixels. */
export function accuracyRadiusPx(accuracyM: number, lat: number, zoom: number): number {
  return accuracyM / metersPerPixel(lat, zoom);
}
