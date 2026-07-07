import { clipPolylinesToConvex, insetConvex, type Pt } from './clip';
import { hexagonCorners } from './shape';
import type { Body, RawTerrain, TileParams } from './types';

export type RouteStation = {
  x: number; // tile-local meters
  y: number;
  ele: number; // raw surface elevation at the station (m)
  bed: number; // smoothed road-bed elevation (m)
};

/**
 * Route stations per chain: the GPS polylines clipped to the tile shape
 * (inset by half the route width so the ribbon never pokes outside),
 * resampled finely, XY-smoothed, with an envelope-smoothed bed elevation.
 */
export function routeStations(raw: RawTerrain, params: TileParams): RouteStation[][] {
  const { cellsX, cellsY, heights, routeXY, routeBreaks, widthMeters, heightMeters } = raw;
  const nx = cellsX + 1;
  const cellM = widthMeters / cellsX;
  const scaleXY = params.tileWidthMM / widthMeters; // mm per meter
  const halfWidthM = params.routeWidthMM / scaleXY / 2;

  const shapePoly: Pt[] =
    params.shape === 'hexagon'
      ? hexagonCorners(widthMeters, heightMeters)
      : [
          { x: 0, y: 0 },
          { x: widthMeters, y: 0 },
          { x: widthMeters, y: heightMeters },
          { x: 0, y: heightMeters },
        ];
  const inset = insetConvex(shapePoly, halfWidthM);

  const eleAt = (x: number, y: number): number => {
    const gx = Math.min(Math.max(x / cellM, 0), cellsX - 1e-9);
    const gy = Math.min(Math.max(y / cellM, 0), cellsY - 1e-9);
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    return (
      heights[j * nx + i] * (1 - fx) * (1 - fy) +
      heights[j * nx + i + 1] * fx * (1 - fy) +
      heights[(j + 1) * nx + i] * (1 - fx) * fy +
      heights[(j + 1) * nx + i + 1] * fx * fy
    );
  };

  const rawChains = clipPolylinesToConvex(routeXY, routeBreaks, inset);
  const step = cellM * 0.6;
  const windowM = params.routeSmoothMM / scaleXY;
  const w = Math.max(1, Math.round(windowM / step));

  // Clean each chain before sweeping: GPS jitter at stops produces hundreds
  // of crossing micro-segments — the ribbon then overlaps itself into a
  // stack of z-fighting plates. Collapse points closer than a fraction of
  // the ribbon width, then simplify sub-width wiggles (endpoints kept, so
  // routes still meet tile edges exactly).
  const minDist = Math.max(step * 0.5, halfWidthM * 0.4);
  const chains = rawChains.map((chain) => {
    const kept: Pt[] = [chain[0]];
    for (let p = 1; p < chain.length; p++) {
      const last = kept[kept.length - 1];
      if (Math.hypot(chain[p].x - last.x, chain[p].y - last.y) >= minDist) {
        kept.push(chain[p]);
      } else if (p === chain.length - 1 && kept.length > 1) {
        kept[kept.length - 1] = chain[p]; // always end at the true endpoint
      }
    }
    return simplifyDP(kept, halfWidthM * 0.35);
  });

  const out: RouteStation[][] = [];
  for (const chain of chains) {
    if (chain.length < 2) continue;
    // resample at even arc spacing
    const xs: number[] = [chain[0].x];
    const ys: number[] = [chain[0].y];
    for (let p = 1; p < chain.length; p++) {
      const n = Math.max(1, Math.ceil(Math.hypot(chain[p].x - xs[xs.length - 1], chain[p].y - ys[ys.length - 1]) / step));
      for (let s = 1; s <= n; s++) {
        xs.push(xs[xs.length - 1] + (chain[p].x - xs[xs.length - 1]) / (n - s + 1));
        ys.push(ys[ys.length - 1] + (chain[p].y - ys[ys.length - 1]) / (n - s + 1));
      }
    }
    const m = xs.length;
    if (m < 2) continue;

    // XY smoothing for curviness (endpoints pinned so tile joins line up)
    if (w > 1 && m > 4) {
      smoothPinned(xs, Math.max(1, Math.round(w / 2)));
      smoothPinned(ys, Math.max(1, Math.round(w / 2)));
    }

    // bed elevation: blur + clamp passes, finished with a blur (a pure
    // road-bed profile; never end on a clamp — that re-serrates)
    const ele = xs.map((x, i) => eleAt(x, ys[i]));
    const bed = ele.slice();
    for (let pass = 0; pass < 2; pass++) {
      boxBlur(bed, w);
      for (let i = 0; i < m; i++) bed[i] = Math.max(bed[i], ele[i]);
    }
    boxBlur(bed, w);

    out.push(xs.map((x, i) => ({ x, y: ys[i], ele: ele[i], bed: bed[i] })));
  }
  return out;
}

/**
 * The route as a swept ribbon solid: smooth curves in plan following the
 * GPS line (not raster cells), constant width, bottom at the base top, top
 * on the smoothed bed (+ ridge). Terrain runs uninterrupted beneath it —
 * the overlap region is strictly internal, so slicers may assign it to
 * either body without any visible difference.
 */
export function buildRouteRibbon(
  raw: RawTerrain,
  params: TileParams,
  /** Circular holes (tile-local meters) where marker pedestals replace the ribbon */
  cutouts?: { x: number; y: number; r: number }[]
): Body | null {
  if (params.routeWidthMM <= 0) return null;
  let chains = routeStations(raw, params);
  if (cutouts?.length) {
    const cut: RouteStation[][] = [];
    for (const chain of chains) {
      let cur: RouteStation[] = [];
      for (const st of chain) {
        const inside = cutouts.some((c) => (st.x - c.x) ** 2 + (st.y - c.y) ** 2 < c.r * c.r);
        if (inside) {
          if (cur.length >= 2) cut.push(cur);
          cur = [];
        } else {
          cur.push(st);
        }
      }
      if (cur.length >= 2) cut.push(cur);
    }
    chains = cut;
  }
  if (chains.length === 0) return null;

  const scaleXY = params.tileWidthMM / raw.widthMeters;
  const scaleZ = scaleXY * params.verticalExaggeration;
  const zBase = params.baseThicknessMM;
  const zOf = (ele: number) => zBase + 0.4 + (ele - raw.minEle) * scaleZ;
  const halfW = params.routeWidthMM / 2;
  const ridge = params.ridgeHeightMM;

  const tris: number[] = [];
  const tri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
  ) => tris.push(ax, ay, az, bx, by, bz, cx, cy, cz);

  for (const chain of chains) {
    // drop coincident stations so no zero-length segment can open a hole
    const st: RouteStation[] = [];
    for (const s of chain) {
      const prev = st[st.length - 1];
      if (!prev || Math.hypot(s.x - prev.x, s.y - prev.y) > 1e-6) st.push(s);
    }
    const m = st.length;
    if (m < 2) continue;

    // mm coordinates + per-station top height
    const X = new Float64Array(m);
    const Y = new Float64Array(m);
    const T = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      X[k] = st[k].x * scaleXY;
      Y[k] = st[k].y * scaleXY;
      T[k] =
        ridge > 0
          ? zOf(st[k].bed) + ridge
          : Math.max(zOf(st[k].ele), zOf(st[k].bed)) + 0.15; // flush: just proud of the surface
    }

    // offset points with clamped miter joins
    const LX = new Float64Array(m);
    const LY = new Float64Array(m);
    const RX = new Float64Array(m);
    const RY = new Float64Array(m);
    let pdx = 1;
    let pdy = 0;
    for (let k = 0; k < m; k++) {
      const p = Math.max(0, k - 1);
      const q = Math.min(m - 1, k + 1);
      let dx = X[q] - X[p];
      let dy = Y[q] - Y[p];
      const len = Math.hypot(dx, dy);
      if (len > halfW * 0.05) {
        dx /= len;
        dy /= len;
        pdx = dx;
        pdy = dy;
      } else {
        // near-reversal (hairpin apex): the averaged direction collapses —
        // reuse the previous direction so the cross-section can't bowtie
        dx = pdx;
        dy = pdy;
      }
      // left normal; miter clamp folded into the averaged direction
      LX[k] = X[k] - dy * halfW;
      LY[k] = Y[k] + dx * halfW;
      RX[k] = X[k] + dy * halfW;
      RY[k] = Y[k] - dx * halfW;
    }

    for (let k = 0; k < m - 1; k++) {
      // top (up)
      tri(LX[k], LY[k], T[k], RX[k], RY[k], T[k], RX[k + 1], RY[k + 1], T[k + 1]);
      tri(LX[k], LY[k], T[k], RX[k + 1], RY[k + 1], T[k + 1], LX[k + 1], LY[k + 1], T[k + 1]);
      // bottom (down)
      tri(LX[k], LY[k], zBase, RX[k + 1], RY[k + 1], zBase, RX[k], RY[k], zBase);
      tri(LX[k], LY[k], zBase, LX[k + 1], LY[k + 1], zBase, RX[k + 1], RY[k + 1], zBase);
      // left wall (outward = left of travel): A = L[k+1], B = L[k]
      tri(LX[k + 1], LY[k + 1], zBase, LX[k], LY[k], zBase, LX[k], LY[k], T[k]);
      tri(LX[k + 1], LY[k + 1], zBase, LX[k], LY[k], T[k], LX[k + 1], LY[k + 1], T[k + 1]);
      // right wall (outward = right of travel): A = R[k], B = R[k+1]
      tri(RX[k], RY[k], zBase, RX[k + 1], RY[k + 1], zBase, RX[k + 1], RY[k + 1], T[k + 1]);
      tri(RX[k], RY[k], zBase, RX[k + 1], RY[k + 1], T[k + 1], RX[k], RY[k], T[k]);
    }
    // start cap (outward = -travel): A = L[0], B = R[0]
    tri(LX[0], LY[0], zBase, RX[0], RY[0], zBase, RX[0], RY[0], T[0]);
    tri(LX[0], LY[0], zBase, RX[0], RY[0], T[0], LX[0], LY[0], T[0]);
    // end cap (outward = +travel): A = R[m-1], B = L[m-1]
    const e = m - 1;
    tri(RX[e], RY[e], zBase, LX[e], LY[e], zBase, LX[e], LY[e], T[e]);
    tri(RX[e], RY[e], zBase, LX[e], LY[e], T[e], RX[e], RY[e], T[e]);
  }

  if (tris.length === 0) return null;
  return { name: 'route', positions: new Float32Array(tris) };
}

/** Douglas–Peucker polyline simplification (keeps endpoints) */
function simplifyDP(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a].x;
    const ay = pts[a].y;
    const dx = pts[b].x - ax;
    const dy = pts[b].y - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol * tol;
    for (let i = a + 1; i < b; i++) {
      let d: number;
      if (len2 < 1e-12) {
        d = (pts[i].x - ax) ** 2 + (pts[i].y - ay) ** 2;
      } else {
        const t = Math.min(Math.max(((pts[i].x - ax) * dx + (pts[i].y - ay) * dy) / len2, 0), 1);
        d = (pts[i].x - ax - t * dx) ** 2 + (pts[i].y - ay - t * dy) ** 2;
      }
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** In-place box blur keeping the first/last values pinned */
function smoothPinned(a: number[], w: number) {
  const src = a.slice();
  const n = a.length;
  for (let i = 1; i < n - 1; i++) {
    const lo = Math.max(0, i - w);
    const hi = Math.min(n - 1, i + w);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += src[k];
    a[i] = sum / (hi - lo + 1);
  }
}

function boxBlur(a: number[], w: number) {
  const src = a.slice();
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w);
    const hi = Math.min(n - 1, i + w);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += src[k];
    a[i] = sum / (hi - lo + 1);
  }
}
