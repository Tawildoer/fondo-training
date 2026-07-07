import { classifyCells } from './classify';
import { fetchHeights } from './dem';
import { frameFromSpan, paddedSpan, toLocal, type TileFrame } from './projection';
import { buildMarkerFeatures, type Marker } from './marker';
import { buildRouteRibbon } from './ribbon';
import { HEX_ASPECT, hexagonCoverage } from './shape';
import { buildBodies } from './solids';
import { countCells, tessellate, type TileCell } from './tessellate';
import { fetchWaterPolygons, rasterizeWater } from './water';
import type { Body, EleRange, ModelStats, RawTerrain, TileParams, TrackPoint } from './types';

export type TripLayout = {
  frames: TileFrame[];
  /** Mercator centers, first-visit order along the route */
  cells: TileCell[];
  /** Mercator span of one tile (x) — layout offsets divide by this */
  spanX: number;
};

/**
 * Tessellate the whole trip into map-aligned tiles. Every tile has the same
 * mercator span; adjacent tiles share exact edges, so terrain and route
 * continue seamlessly and printed tiles assemble into a geographically
 * correct map.
 *
 * Tile size is solved to hit `tileTarget` tiles: binary-search the span
 * until the anchor-optimized tessellation uses that many cells, then grow
 * the span by the padding percentage as long as the count holds (extra
 * terrain context without changing the tile count).
 */
export function makeTripLayout(tracks: TrackPoint[][], params: TileParams): TripLayout {
  const hex = params.shape === 'hexagon';
  const aspect = hex ? HEX_ASPECT : 1;
  const target = Math.max(1, Math.round(params.tileTarget));
  const coarse = (span: number) => countCells(tracks, span, span * aspect, params.shape);
  // fine counting runs at the final tessellation's exact resolution so the
  // search result always matches the layout it produces
  const fine = (span: number) => countCells(tracks, span, span * aspect, params.shape, true);

  // Bracket cheaply: hi always yields 1 tile; walk lo down until ≥ target
  const trip = paddedSpan(tracks.flat(), 0, true);
  let hi = Math.max(trip.spanX, trip.spanY) * 3;
  let lo = hi / 2;
  for (let i = 0; i < 14 && coarse(lo) < target; i++) lo /= 2;

  if (fine(lo) >= target) {
    // smallest span whose (fine) tile count is ≤ target
    for (let i = 0; i < 18; i++) {
      const mid = Math.sqrt(lo * hi);
      if (fine(mid) > target) lo = mid;
      else hi = mid;
    }
  } // else: even tiny tiles can't reach target (degenerate short route) — use hi

  // Exact counts can be unachievable (a diagonal ride's tile count may jump
  // 2 → 4 with no anchor giving 3) — settle on the nearest achievable side,
  // preferring fewer tiles on a tie.
  let spanX = hi;
  const cHi = fine(hi);
  if (cHi !== target) {
    const cLo = fine(lo);
    if (cLo >= target && Math.abs(cLo - target) < Math.abs(cHi - target)) spanX = lo;
  }

  // Spend the padding budget growing tiles within the same-count plateau
  const padded = spanX * (1 + params.paddingPct / 100);
  if (fine(padded) === fine(spanX)) spanX = padded;

  const spanY = spanX * aspect;
  const cells = tessellate(tracks, spanX, spanY, params.shape);
  return {
    frames: cells.map((c) => frameFromSpan(c.cx, c.cy, spanX, spanY)),
    cells,
    spanX,
  };
}

/**
 * Network-dependent stage: fetch elevations and water for one tile's frame
 * and sample both onto the grid. The full trip (all rides) is projected into
 * the tile so the route continues across tile edges. Re-run only when the
 * tracks, coverage, shape, or grid resolution change.
 */
export async function fetchTerrain(
  tracks: TrackPoint[][],
  params: TileParams,
  frame: TileFrame
): Promise<RawTerrain> {
  const cellsX = params.gridRes;
  const cellsY = Math.max(2, Math.round((cellsX * frame.heightMeters) / frame.widthMeters));

  const heightsPromise = fetchHeights(frame, cellsX, cellsY);

  let waterMask: Uint8Array = new Uint8Array(cellsX * cellsY);
  let waterOk = false;
  const waterPromise = fetchWaterPolygons(frame)
    .then((polys) => {
      waterMask = rasterizeWater(polys, frame, cellsX, cellsY);
      waterOk = true;
    })
    .catch((err) => {
      console.warn('Water fetch failed, continuing without OSM water:', err);
    });

  const [heights] = await Promise.all([heightsPromise, waterPromise]);

  let minEle = Infinity;
  let maxEle = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const e = heights[i];
    if (e < minEle) minEle = e;
    if (e > maxEle) maxEle = e;
  }

  const totalPoints = tracks.reduce((n, t) => n + t.length, 0);
  const routeXY = new Float32Array(totalPoints * 2);
  const routeBreaks = new Uint32Array(tracks.length);
  let pi = 0;
  tracks.forEach((track, ti) => {
    routeBreaks[ti] = pi;
    for (const p of track) {
      const [x, y] = toLocal(frame, p.lon, p.lat);
      routeXY[pi * 2] = x;
      routeXY[pi * 2 + 1] = y;
      pi++;
    }
  });

  return {
    cellsX,
    cellsY,
    heights,
    waterMask,
    widthMeters: frame.widthMeters,
    heightMeters: frame.heightMeters,
    minEle,
    maxEle,
    bounds: frame.bounds,
    routeXY,
    routeBreaks,
    waterOk,
  };
}

/**
 * Synchronous stage: classify cells, build the printable terrain solids and
 * the route ribbon, and precompute face normals. Re-run on any slider
 * change — designed to run inside a Web Worker so the UI never blocks.
 */
export function buildModel(
  raw: RawTerrain,
  params: TileParams,
  distanceKm: number,
  eleOverride?: EleRange,
  markers?: Marker[]
): { bodies: Body[]; stats: ModelStats } {
  // Trip-wide elevation range (multi-day sets) keeps color thresholds and
  // vertical scale identical across every tile.
  const r: RawTerrain = eleOverride
    ? { ...raw, minEle: eleOverride.min, maxEle: eleOverride.max }
    : raw;

  const coverage =
    params.shape === 'hexagon' ? hexagonCoverage(r.cellsX, r.cellsY) : null;
  const classified = classifyCells(r, params, coverage);
  // Climb markers are real geometry: pedestals with modeled pockets merged
  // into the route body, the ribbon interrupted underneath, and terrain
  // capped below each pocket so nothing refills the hole.
  const features = markers?.length ? buildMarkerFeatures(r, params, markers) : null;
  const bodies = buildBodies(r, classified, params, coverage, features?.caps ?? null);
  const ribbon = buildRouteRibbon(r, params, features?.cutouts);
  if (ribbon || features) {
    const parts = [ribbon?.positions, features?.pedestals].filter(
      (p): p is Float32Array => !!p && p.length > 0
    );
    if (parts.length) {
      const merged = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
      let o = 0;
      for (const p of parts) {
        merged.set(p, o);
        o += p.length;
      }
      bodies.push({ name: 'route', positions: merged });
    }
  }
  if (features) bodies.push(features.preview); // viewer-only red plugs
  for (const body of bodies) body.normals = faceNormals(body.positions);

  const scaleXY = params.tileWidthMM / r.widthMeters;
  const scaleZ = scaleXY * params.verticalExaggeration;
  const stats: ModelStats = {
    widthMM: params.tileWidthMM,
    depthMM: r.heightMeters * scaleXY,
    heightMM:
      params.baseThicknessMM + 0.4 + (raw.maxEle - r.minEle) * scaleZ + params.ridgeHeightMM,
    triangles: bodies.reduce((n, b) => n + b.positions.length / 9, 0),
    eleRangeM: raw.maxEle - raw.minEle,
    distanceKm,
  };
  return { bodies, stats };
}

/** Flat per-vertex face normals for non-indexed triangle soup */
function faceNormals(pos: Float32Array): Float32Array {
  const normals = new Float32Array(pos.length);
  for (let t = 0; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t];
    const uy = pos[t + 4] - pos[t + 1];
    const uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t];
    const vy = pos[t + 7] - pos[t + 1];
    const vz = pos[t + 8] - pos[t + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let v = 0; v < 9; v += 3) {
      normals[t + v] = nx;
      normals[t + v + 1] = ny;
      normals[t + v + 2] = nz;
    }
  }
  return normals;
}
