import { clipCellSnapped, pointInConvex, type Pt } from './clip';

export type TileShape = 'square' | 'hexagon';

/**
 * Pointy-top regular hexagon (flat sides left/right so consecutive day tiles
 * butt edge-to-edge in a row). For flat-to-flat width W: circumradius
 * R = W/√3, total height 2R.
 */

/** frame height / frame width for a hexagon tile */
export const HEX_ASPECT = 2 / Math.sqrt(3);

/**
 * Frame width needed to guarantee a centered square bbox of side s fits
 * inside the hexagon: corner test gives W ≥ s(√3+1)/2.
 */
export const HEX_FIT_FACTOR = (Math.sqrt(3) + 1) / 2;

/**
 * Pointy-top hexagon corners for a w × h bounding box (h = w·HEX_ASPECT),
 * CCW. Works in any unit (mm, meters, cells) as long as the aspect holds.
 */
export function hexagonCorners(w: number, h: number): Pt[] {
  const cx = w / 2;
  const cy = h / 2;
  const R = h / 2;
  const hw = w / 2;
  return [
    { x: cx, y: cy + R },
    { x: cx - hw, y: cy + R / 2 },
    { x: cx - hw, y: cy - R / 2 },
    { x: cx, y: cy - R },
    { x: cx + hw, y: cy - R / 2 },
    { x: cx + hw, y: cy + R / 2 },
  ];
}

/**
 * Per-cell hexagon coverage: 0 = outside, 1 = partial (the cell is cut by a
 * hexagon edge and gets exact-clipped geometry), 2 = fully inside. Partial
 * cells with negligible clipped area count as outside so classification and
 * geometry can never disagree about whether a cell exists.
 */
export function hexagonCoverage(cellsX: number, cellsY: number): Uint8Array {
  const poly = hexagonCorners(cellsX, cellsY);
  const cov = new Uint8Array(cellsX * cellsY);
  const tx = new Float64Array(16);
  const ty = new Float64Array(16);
  const sx = new Float64Array(16);
  const sy = new Float64Array(16);

  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      let inside = 0;
      if (pointInConvex(poly, i, j)) inside++;
      if (pointInConvex(poly, i + 1, j)) inside++;
      if (pointInConvex(poly, i, j + 1)) inside++;
      if (pointInConvex(poly, i + 1, j + 1)) inside++;
      if (inside === 4) {
        cov[j * cellsX + i] = 2;
        continue;
      }
      if (inside === 0) {
        // only a hexagon vertex inside the cell can still make it partial
        const vertexInCell = poly.some(
          (p) => p.x >= i && p.x <= i + 1 && p.y >= j && p.y <= j + 1
        );
        if (!vertexInCell) continue;
      }
      if (clipCellSnapped(i, j, poly, sx, sy, tx, ty) >= 3) {
        cov[j * cellsX + i] = 1;
      }
    }
  }
  return cov;
}

/**
 * Watertight hexagonal prism (the tile base) from z=0 to z=zTop, in mm.
 * Vertices ordered CCW seen from +Z; outward-facing walls.
 */
export function hexagonPrism(widthMM: number, depthMM: number, zTop: number): Float32Array {
  const cx = widthMM / 2;
  const cy = depthMM / 2;
  const R = depthMM / 2;
  const hw = widthMM / 2;
  // CCW: top point, upper-left, lower-left, bottom point, lower-right, upper-right
  const v: [number, number][] = [
    [cx, cy + R],
    [cx - hw, cy + R / 2],
    [cx - hw, cy - R / 2],
    [cx, cy - R],
    [cx + hw, cy - R / 2],
    [cx + hw, cy + R / 2],
  ];
  const out: number[] = [];
  const tri = (
    a: [number, number], b: [number, number], c: [number, number],
    za: number, zb: number, zc: number
  ) => out.push(a[0], a[1], za, b[0], b[1], zb, c[0], c[1], zc);

  for (let i = 1; i < 5; i++) {
    tri(v[0], v[i], v[i + 1], zTop, zTop, zTop); // top fan (CCW from above)
    tri(v[0], v[i + 1], v[i], 0, 0, 0); // bottom fan (reversed)
  }
  for (let i = 0; i < 6; i++) {
    const a = v[i];
    const b = v[(i + 1) % 6];
    // walking CCW keeps the exterior on the right → outward normal
    out.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], zTop);
    out.push(a[0], a[1], 0, b[0], b[1], zTop, a[0], a[1], zTop);
  }
  return new Float32Array(out);
}
