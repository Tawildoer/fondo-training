import type { Classified } from './classify';
import { clipCellSnapped } from './clip';
import { hexagonCorners, hexagonPrism } from './shape';
import {
  BODY_NAMES,
  CLASS,
  CLASS_NONE,
  CLASS_TO_BODY,
  type Body,
  type BodyName,
  type RawTerrain,
  type TileParams,
} from './types';

/**
 * Build printable solids from the classified heightmap.
 *
 * Each cell is a column whose footprint is the cell square — or, on a
 * hexagon tile's rim, the square exactly clipped by the hexagon edges, so
 * the tile boundary is a straight slanted line, not a staircase. Columns
 * stack color layers (land below the rock line, rock to the snow line,
 * snow above); each color body is independently watertight: top/bottom
 * fans per layer, and walls where the neighboring cell's same-body layer
 * doesn't cover the interval (split at the layer lines so vertical edges
 * share breakpoints). Adjacent bodies share coincident walls, which slicers
 * accept happily. The base is a separate slab body.
 *
 * The route is not built here — it's a swept ribbon (lib/ribbon.ts) laid
 * through the continuous terrain.
 *
 * Output coordinates are millimeters, Z up (print orientation).
 */

/** Growable Float32Array so triangle emission avoids number[] GC churn */
class TriBuffer {
  private buf = new Float32Array(9 * 1024);
  private len = 0;

  push(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
  ) {
    if (this.len + 9 > this.buf.length) {
      const next = new Float32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    const b = this.buf;
    const o = this.len;
    b[o] = ax; b[o + 1] = ay; b[o + 2] = az;
    b[o + 3] = bx; b[o + 4] = by; b[o + 5] = bz;
    b[o + 6] = cx; b[o + 7] = cy; b[o + 8] = cz;
    this.len += 9;
  }

  get size() {
    return this.len;
  }

  toArray(): Float32Array {
    return this.buf.slice(0, this.len);
  }
}

const MAXV = 16;

export function buildBodies(
  raw: RawTerrain,
  classified: Classified,
  params: TileParams,
  /** Hexagon coverage per cell (0 outside / 1 partial / 2 full), or null */
  coverage?: Uint8Array | null,
  /** Per-cell terrain cap (mm, NaN = uncapped) — keeps terrain out of marker pockets */
  caps?: Float64Array | null
): Body[] {
  const { cellsX, cellsY, heights, widthMeters, heightMeters, minEle } = raw;
  const { cellClass, flatLevel } = classified;
  const nx = cellsX + 1;

  const scaleXY = params.tileWidthMM / widthMeters; // mm per meter
  const scaleZ = scaleXY * params.verticalExaggeration;
  const zBase = params.baseThicknessMM;
  const depthMM = heightMeters * scaleXY;
  const cellMMX = params.tileWidthMM / cellsX;
  const cellMMY = depthMM / cellsY;

  // Small floor so even the lowest terrain has printable material above the base
  const Z_FLOOR = 0.4;
  const zOf = (ele: number) => zBase + Z_FLOOR + (ele - minEle) * scaleZ;

  const EPS = 1e-9;

  // Global split planes: rock/snow filament only above their slider lines —
  // below, the column is land (saves filament). Same thresholds as classify.
  const range = Math.max(raw.maxEle - raw.minEle, 1e-6);
  const rockZ = zOf(raw.minEle + (params.rockLinePct / 100) * range);
  const snowZ = zOf(raw.minEle + (params.snowLinePct / 100) * range);

  const hexPoly = params.shape === 'hexagon' ? hexagonCorners(cellsX, cellsY) : null;

  // Water is a thin cap (like rock/snow): WATER_D of blue at the lake
  // surface, land filament beneath. Levels are per-lake, so the land/water
  // boundary is derived per vertex from the adjacent water cell's level.
  const WATER_D = 1.5;
  const waterFloor = zBase + Z_FLOOR / 2; // land under water never collapses to zero
  const waterLandAt = (waterTopMM: number) => Math.max(waterTopMM - WATER_D, waterFloor);

  /** land-under-water top per grid vertex (NaN where no water touches) */
  const waterLand = new Float64Array(nx * (cellsY + 1)).fill(NaN);
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const c = j * cellsX + i;
      if (cellClass[c] !== CLASS.water) continue;
      const flat = flatLevel[c];
      const flatMM = Number.isNaN(flat) ? NaN : zOf(flat);
      for (const v of [j * nx + i, j * nx + i + 1, (j + 1) * nx + i, (j + 1) * nx + i + 1]) {
        const wt = Number.isNaN(flatMM) ? zOf(heights[v]) : flatMM;
        waterLand[v] = waterLandAt(wt);
      }
    }
  }

  const buffers: Record<BodyName, TriBuffer> = {
    base: new TriBuffer(),
    water: new TriBuffer(),
    grass: new TriBuffer(),
    rock: new TriBuffer(),
    snow: new TriBuffer(),
    route: new TriBuffer(),
    marker: new TriBuffer(),
  };

  const tri = (
    buf: TriBuffer,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
  ) => {
    buf.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  /**
   * Top of `body`'s layer inside a neighbor cell at a shared vertex whose
   * raw surface height is `hs` (mm), or null if that body is absent there.
   * `nFlatMM` is the neighbor's flattened lake level (NaN if none).
   */
  const neighborBodyTop = (
    body: BodyName,
    ncls: number,
    hs: number,
    nFlatMM: number
  ): number | null => {
    if (body === 'grass') {
      if (ncls === CLASS.grass) return hs;
      if (ncls === CLASS.rock || ncls === CLASS.snow) return Math.min(rockZ, hs);
      if (ncls === CLASS.water) return waterLandAt(Number.isNaN(nFlatMM) ? hs : nFlatMM);
      return null;
    }
    if (body === 'rock') {
      if (ncls === CLASS.rock) return hs;
      if (ncls === CLASS.snow) return Math.min(snowZ, hs);
      return null;
    }
    if (body === 'snow') return ncls === CLASS.snow ? hs : null;
    if (body === 'water') {
      // needed when caps differ between adjacent water cells; equal-cap
      // same-class edges are skipped before this is consulted
      if (ncls === CLASS.water) return Number.isNaN(nFlatMM) ? hs : nFlatMM;
      return null;
    }
    return null;
  };

  /** Wall segment [bot, top] per corner, A->B ordered CCW (outward right) */
  function wallSeg(
    buf: TriBuffer,
    ax: number, ay: number, aBot: number, aTop: number,
    bx: number, by: number, bBot: number, bTop: number
  ) {
    if (bTop - bBot > EPS) tri(buf, ax, ay, aBot, bx, by, bBot, bx, by, bTop);
    if (aTop - aBot > EPS) tri(buf, ax, ay, aBot, bx, by, bTop, ax, ay, aTop);
  }

  // ---- per-cell scratch (no allocation in the hot loop) ----
  const vx = new Float64Array(MAXV); // polygon verts, cell units
  const vy = new Float64Array(MAXV);
  const tmpX = new Float64Array(MAXV);
  const tmpY = new Float64Array(MAXV);
  const surfMM = new Float64Array(MAXV); // raw surface at verts, mm
  const topA = new Float64Array(MAXV); // layer tops (up to 3 layers)
  const topB = new Float64Array(MAXV);
  const topC = new Float64Array(MAXV);
  const layerTops = [topA, topB, topC];
  const bot = new Float64Array(MAXV);
  const kinds = new Int8Array(MAXV); // edge starting at vert i: 0 S,1 E,2 N,3 W,4 rim
  const layerBodies: BodyName[] = ['grass', 'grass', 'grass'];

  /**
   * Land-under-water boundary at polygon vertex v (grass-wall breakpoint),
   * or -Infinity when no water touches. Grid vertices use the precomputed
   * per-vertex table (canonical across all cells sharing the corner);
   * clipped rim points are shared by at most the two cells at hand.
   */
  const waterLandBreak = (
    v: number,
    cls: number,
    ncls: number,
    flatMM: number,
    nFlatMM: number
  ): number => {
    const gx = Math.round(vx[v]);
    const gy = Math.round(vy[v]);
    if (Math.abs(vx[v] - gx) < 1e-7 && Math.abs(vy[v] - gy) < 1e-7) {
      const wl = waterLand[gy * nx + gx];
      return Number.isNaN(wl) ? -Infinity : wl;
    }
    if (cls === CLASS.water) return waterLandAt(Number.isNaN(flatMM) ? surfMM[v] : flatMM);
    if (ncls === CLASS.water) return waterLandAt(Number.isNaN(nFlatMM) ? surfMM[v] : nFlatMM);
    return -Infinity;
  };

  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const c = j * cellsX + i;
      const cls = cellClass[c];
      if (cls === CLASS_NONE) continue;

      // --- footprint polygon (cell units, CCW) ---
      let n: number;
      if (hexPoly && coverage && coverage[c] === 1) {
        n = clipCellSnapped(i, j, hexPoly, vx, vy, tmpX, tmpY);
        if (n < 3) continue; // cannot happen: coverage used the same clip
      } else {
        n = 4;
        vx[0] = i; vy[0] = j;
        vx[1] = i + 1; vy[1] = j;
        vx[2] = i + 1; vy[2] = j + 1;
        vx[3] = i; vy[3] = j + 1;
      }

      // corner heights of this cell for bilinear interpolation
      const h00 = heights[j * nx + i];
      const h10 = heights[j * nx + i + 1];
      const h01 = heights[(j + 1) * nx + i];
      const h11 = heights[(j + 1) * nx + i + 1];
      for (let v = 0; v < n; v++) {
        const u = Math.min(Math.max(vx[v] - i, 0), 1);
        const w = Math.min(Math.max(vy[v] - j, 0), 1);
        const ele =
          h00 * (1 - u) * (1 - w) + h10 * u * (1 - w) + h01 * (1 - u) * w + h11 * u * w;
        surfMM[v] = zOf(ele);
      }

      // edge kinds: on a cell side (S/E/N/W → neighbor exists) or on the rim
      for (let v = 0; v < n; v++) {
        const q = (v + 1) % n;
        const ay = vy[v], by = vy[q], ax = vx[v], bx = vx[q];
        if (Math.abs(ay - j) < 1e-7 && Math.abs(by - j) < 1e-7) kinds[v] = 0; // S
        else if (Math.abs(ax - (i + 1)) < 1e-7 && Math.abs(bx - (i + 1)) < 1e-7) kinds[v] = 1; // E
        else if (Math.abs(ay - (j + 1)) < 1e-7 && Math.abs(by - (j + 1)) < 1e-7) kinds[v] = 2; // N
        else if (Math.abs(ax - i) < 1e-7 && Math.abs(bx - i) < 1e-7) kinds[v] = 3; // W
        else kinds[v] = 4; // rim
      }

      // --- layer stack tops per vertex ---
      const flat = flatLevel[c];
      const flatMM = Number.isNaN(flat) ? NaN : zOf(flat);
      let layerCount: number;
      if (cls === CLASS.rock) {
        layerCount = 2;
        layerBodies[0] = 'grass';
        layerBodies[1] = 'rock';
        for (let v = 0; v < n; v++) {
          topA[v] = Math.min(rockZ, surfMM[v]);
          topB[v] = surfMM[v];
        }
      } else if (cls === CLASS.snow) {
        layerCount = 3;
        layerBodies[0] = 'grass';
        layerBodies[1] = 'rock';
        layerBodies[2] = 'snow';
        for (let v = 0; v < n; v++) {
          topA[v] = Math.min(rockZ, surfMM[v]);
          topB[v] = Math.min(snowZ, surfMM[v]);
          topC[v] = surfMM[v];
        }
      } else if (cls === CLASS.water) {
        layerCount = 2;
        layerBodies[0] = 'grass';
        layerBodies[1] = 'water';
        for (let v = 0; v < n; v++) {
          const wt = Number.isNaN(flatMM) ? surfMM[v] : flatMM;
          topA[v] = waterLandAt(wt);
          topB[v] = wt;
        }
      } else {
        layerCount = 1;
        layerBodies[0] = CLASS_TO_BODY[cls as keyof typeof CLASS_TO_BODY];
        for (let v = 0; v < n; v++) {
          topA[v] = surfMM[v];
        }
      }

      // marker-pocket cap: clamp every layer so terrain never refills a
      // pocket (the cell-blocky cut hides inside the pedestal wall)
      const ownCap = caps ? caps[c] : NaN;
      if (!Number.isNaN(ownCap)) {
        for (let li = 0; li < layerCount; li++) {
          const t = layerTops[li];
          for (let v = 0; v < n; v++) t[v] = Math.max(Math.min(t[v], ownCap), zBase);
        }
      }

      for (let v = 0; v < n; v++) bot[v] = zBase;

      for (let li = 0; li < layerCount; li++) {
        const body = layerBodies[li];
        const buf = buffers[body];
        const top = layerTops[li];

        // top fan (CCW, up) and bottom fan (down)
        for (let t = 1; t < n - 1; t++) {
          tri(
            buf,
            vx[0] * cellMMX, vy[0] * cellMMY, top[0],
            vx[t] * cellMMX, vy[t] * cellMMY, top[t],
            vx[t + 1] * cellMMX, vy[t + 1] * cellMMY, top[t + 1]
          );
          tri(
            buf,
            vx[0] * cellMMX, vy[0] * cellMMY, bot[0],
            vx[t + 1] * cellMMX, vy[t + 1] * cellMMY, bot[t + 1],
            vx[t] * cellMMX, vy[t] * cellMMY, bot[t]
          );
        }

        // walls per polygon edge (CCW traversal → outward on the right)
        for (let v = 0; v < n; v++) {
          const q = (v + 1) % n;
          const kind = kinds[v];
          let nc = -1;
          if (kind === 0 && j > 0) nc = c - cellsX;
          else if (kind === 1 && i < cellsX - 1) nc = c + 1;
          else if (kind === 2 && j < cellsY - 1) nc = c + cellsX;
          else if (kind === 3 && i > 0) nc = c - 1;
          const ncls: number = nc >= 0 ? cellClass[nc] : CLASS_NONE;
          const nCap = caps && nc >= 0 ? caps[nc] : NaN;
          const capsMatch =
            (Number.isNaN(ownCap) && Number.isNaN(nCap)) || ownCap === nCap;

          // same class AND same cap: layers line up exactly, no wall
          if (kind !== 4 && ncls === cls && capsMatch) continue;

          let ntA: number | null = null;
          let ntB: number | null = null;
          let nFlatMM = NaN;
          if (kind !== 4 && ncls !== CLASS_NONE) {
            if (ncls === CLASS.water && !Number.isNaN(flatLevel[nc])) {
              nFlatMM = zOf(flatLevel[nc]);
            }
            ntA = neighborBodyTop(body, ncls, surfMM[v], nFlatMM);
            ntB = neighborBodyTop(body, ncls, surfMM[q], nFlatMM);
            if (!Number.isNaN(nCap)) {
              if (ntA !== null) ntA = Math.max(Math.min(ntA, nCap), zBase);
              if (ntB !== null) ntB = Math.max(Math.min(ntB, nCap), zBase);
            }
          }
          const lowA = Math.min(Math.max(ntA ?? bot[v], bot[v]), top[v]);
          const lowB = Math.min(Math.max(ntB ?? bot[q], bot[q]), top[q]);

          const ax = vx[v] * cellMMX;
          const ay = vy[v] * cellMMY;
          const bx = vx[q] * cellMMX;
          const by = vy[q] * cellMMY;

          // Split walls at the body's layer lines so vertical edges of
          // adjacent walls share breakpoints (T-vertices open holes).
          // Grass has two potential lines: the rock line and — near lakes —
          // the land-under-water boundary of the adjacent water body.
          if (body === 'grass') {
            const s1A = Math.min(rockZ, surfMM[v]);
            const s1B = Math.min(rockZ, surfMM[q]);
            const s2A = waterLandBreak(v, cls, ncls, flatMM, nFlatMM);
            const s2B = waterLandBreak(q, cls, ncls, flatMM, nFlatMM);
            // per-corner sorted breakpoints (sets match across cells even
            // if the two lines cross along the edge)
            const pAlo = Math.min(s1A, s2A);
            const pAhi = Math.max(s1A, s2A);
            const pBlo = Math.min(s1B, s2B);
            const pBhi = Math.max(s1B, s2B);
            const m1A = Math.min(Math.max(pAlo, lowA), top[v]);
            const m1B = Math.min(Math.max(pBlo, lowB), top[q]);
            const m2A = Math.min(Math.max(pAhi, m1A), top[v]);
            const m2B = Math.min(Math.max(pBhi, m1B), top[q]);
            wallSeg(buf, ax, ay, lowA, m1A, bx, by, lowB, m1B);
            wallSeg(buf, ax, ay, m1A, m2A, bx, by, m1B, m2B);
            wallSeg(buf, ax, ay, m2A, top[v], bx, by, m2B, top[q]);
          } else if (body === 'rock') {
            const mA = Math.min(Math.max(Math.min(snowZ, surfMM[v]), lowA), top[v]);
            const mB = Math.min(Math.max(Math.min(snowZ, surfMM[q]), lowB), top[q]);
            wallSeg(buf, ax, ay, lowA, mA, bx, by, lowB, mB);
            wallSeg(buf, ax, ay, mA, top[v], bx, by, mB, top[q]);
          } else {
            wallSeg(buf, ax, ay, lowA, top[v], bx, by, lowB, top[q]);
          }
        }

        for (let v = 0; v < n; v++) bot[v] = top[v];
      }
    }
  }

  // Base slab from z=0 to zBase: hexagonal prism or full-footprint box
  if (params.shape === 'hexagon') {
    const prism = hexagonPrism(params.tileWidthMM, depthMM, zBase);
    for (let v = 0; v < prism.length; v += 9) {
      buffers.base.push(
        prism[v], prism[v + 1], prism[v + 2],
        prism[v + 3], prism[v + 4], prism[v + 5],
        prism[v + 6], prism[v + 7], prism[v + 8]
      );
    }
  } else {
    const b = buffers.base;
    const W = params.tileWidthMM;
    const D = depthMM;
    // bottom (-Z)
    tri(b, 0, 0, 0, 0, D, 0, W, D, 0);
    tri(b, 0, 0, 0, W, D, 0, W, 0, 0);
    // top (+Z)
    tri(b, 0, 0, zBase, W, 0, zBase, W, D, zBase);
    tri(b, 0, 0, zBase, W, D, zBase, 0, D, zBase);
    // south (-Y)
    tri(b, 0, 0, 0, W, 0, 0, W, 0, zBase);
    tri(b, 0, 0, 0, W, 0, zBase, 0, 0, zBase);
    // north (+Y)
    tri(b, W, D, 0, 0, D, 0, 0, D, zBase);
    tri(b, W, D, 0, 0, D, zBase, W, D, zBase);
    // west (-X)
    tri(b, 0, D, 0, 0, 0, 0, 0, 0, zBase);
    tri(b, 0, D, 0, 0, 0, zBase, 0, D, zBase);
    // east (+X)
    tri(b, W, 0, 0, W, D, 0, W, D, zBase);
    tri(b, W, 0, 0, W, D, zBase, W, 0, zBase);
  }

  return BODY_NAMES.filter((name) => buffers[name].size > 0).map((name) => ({
    name,
    positions: buffers[name].toArray(),
  }));
}
