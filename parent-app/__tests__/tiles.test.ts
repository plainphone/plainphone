// SPDX-License-Identifier: Apache-2.0
import { inviteTokenFromUrl } from "../src/lib/links";
import { mapsUrl } from "../src/lib/maps";
import { accuracyRadiusPx, metersPerPixel, tileForPosition, tileGrid, tileUrl, TILE_SIZE } from "../src/lib/tiles";

// Reference values computed with the formulas on the OpenStreetMap wiki (Slippy map tilenames).
describe("map tiles", () => {
  it("finds the tile and the pixel inside it", () => {
    const c = tileForPosition(55.6761, 12.5683, 15);
    expect([c.x, c.y]).toEqual([17527, 10256]);
    expect(c.offsetX).toBeCloseTo(0.994595555556 * 256, 3);
    expect(c.offsetY).toBeCloseTo(0.239624057767 * 256, 3);
    expect(tileForPosition(0, 0, 15)).toEqual({ x: 16384, y: 16384, offsetX: 0, offsetY: 0 });
    const sydney = tileForPosition(-33.8688, 151.2093, 15);
    expect([sydney.x, sydney.y]).toEqual([30147, 19663]);
  });

  it("lays out a 3 by 3 grid with the position at the origin", () => {
    const c = tileForPosition(55.6761, 12.5683, 15);
    const grid = tileGrid(55.6761, 12.5683, 15);
    expect(grid).toHaveLength(9);
    const centre = grid.find((t) => t.x === c.x && t.y === c.y)!;
    expect(centre.left).toBeCloseTo(-c.offsetX, 6);
    expect(centre.top).toBeCloseTo(-c.offsetY, 6);
    // A neighbour sits exactly one tile away.
    const right = grid.find((t) => t.x === c.x + 1 && t.y === c.y)!;
    expect(right.left - centre.left).toBe(TILE_SIZE);
    // Every tile within reach: the position is inside the middle tile, so each side has at least a tile.
    expect(Math.min(...grid.map((t) => t.left))).toBeLessThanOrEqual(-TILE_SIZE);
    expect(Math.max(...grid.map((t) => t.left + TILE_SIZE))).toBeGreaterThanOrEqual(TILE_SIZE);
  });

  it("wraps around the date line and stops at the poles", () => {
    const grid = tileGrid(10, 179.9999, 15);
    expect(grid.map((t) => t.x)).toContain(0);
    expect(grid.every((t) => t.x >= 0 && t.x < 2 ** 15)).toBe(true);
    const north = tileGrid(85.0511, 10, 15);
    expect(north.every((t) => t.y >= 0)).toBe(true);
    expect(north).toHaveLength(6);
  });

  it("builds tile urls and scales accuracy to pixels", () => {
    expect(tileUrl(15, 17527, 10256)).toBe("https://tile.openstreetmap.org/15/17527/10256.png");
    expect(metersPerPixel(55.6761, 15)).toBeCloseTo(2.6938, 3);
    expect(accuracyRadiusPx(100, 55.6761, 15)).toBeCloseTo(37.12, 1);
  });
});

describe("open in maps", () => {
  it("uses the maps app of the platform", () => {
    expect(mapsUrl("ios", 55.6761, 12.5683, "Alma's phone")).toBe("https://maps.apple.com/?ll=55.676100,12.568300&q=Alma's%20phone");
    expect(mapsUrl("android", 55.6761, 12.5683, "Alma")).toBe("geo:55.676100,12.568300?q=55.676100,12.568300");
    expect(mapsUrl("web", 55.6761, 12.5683, "Alma")).toContain("https://www.openstreetmap.org/?mlat=55.67610&mlon=12.56830");
  });
});

describe("invitation links", () => {
  it("only reads the token from an invite link, never from the login link", () => {
    expect(inviteTokenFromUrl("https://app.plainphone.org/invite#token=pp_i_abcdefghij")).toBe("pp_i_abcdefghij");
    expect(inviteTokenFromUrl("plainphone://invite#token=pp_i_abcdefghij")).toBe("pp_i_abcdefghij");
    expect(inviteTokenFromUrl("https://app.plainphone.org/auth/app#token=pp_m_abcdefghij")).toBeNull();
    expect(inviteTokenFromUrl("https://app.plainphone.org/invite")).toBeNull();
    expect(inviteTokenFromUrl(null)).toBeNull();
  });
});
