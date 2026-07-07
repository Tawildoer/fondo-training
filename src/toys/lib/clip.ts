/** 2D convex-polygon utilities (polygons are CCW). */

export type Pt = { x: number; y: number };

const EPS = 1e-9;

export function pointInConvex(poly: Pt[], x: number, y: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < -EPS) return false;
  }
  return true;
}

export function polygonArea(xs: Float64Array, ys: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += xs[i] * ys[j] - xs[j] * ys[i];
  }
  return s / 2;
}

/**
 * Sutherland–Hodgman: clip the polygon in (xs, ys, n) by convex CCW `clip`,
 * writing the result back in place. Returns the new vertex count (0 if the
 * intersection is empty). Buffers must hold at least n + clip.length verts.
 */
export function clipConvexInPlace(
  xs: Float64Array,
  ys: Float64Array,
  n: number,
  clip: Pt[],
  tmpX: Float64Array,
  tmpY: Float64Array
): number {
  let inX = xs;
  let inY = ys;
  let outX = tmpX;
  let outY = tmpY;
  let count = n;

  for (let e = 0; e < clip.length && count >= 3; e++) {
    const a = clip[e];
    const b = clip[(e + 1) % clip.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    let m = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const dp = ex * (inY[i] - a.y) - ey * (inX[i] - a.x);
      const dq = ex * (inY[j] - a.y) - ey * (inX[j] - a.x);
      const pIn = dp >= -EPS;
      const qIn = dq >= -EPS;
      if (pIn) {
        outX[m] = inX[i];
        outY[m] = inY[i];
        m++;
      }
      if (pIn !== qIn) {
        const t = dp / (dp - dq);
        outX[m] = inX[i] + t * (inX[j] - inX[i]);
        outY[m] = inY[i] + t * (inY[j] - inY[i]);
        m++;
      }
    }
    // swap
    const sx = inX, sy = inY;
    inX = outX;
    inY = outY;
    outX = sx;
    outY = sy;
    count = m;
  }

  if (inX !== xs) {
    for (let i = 0; i < count; i++) {
      xs[i] = inX[i];
      ys[i] = inY[i];
    }
  }
  return count < 3 ? 0 : count;
}

/**
 * Clip the unit cell (i,j)..(i+1,j+1) by a convex CCW polygon, snapping the
 * result to a 0.01-cell grid and dropping duplicate vertices. Snapping makes
 * shared-edge intersection points bit-identical across neighboring cells
 * (different traversal orders otherwise differ in the last ulp and open
 * micro-holes), and the dedupe kills degenerate triangles from slivers.
 * Returns the vertex count (0 for empty/negligible intersections) — used by
 * BOTH coverage classification and geometry so they can never disagree.
 */
export function clipCellSnapped(
  i: number,
  j: number,
  clip: Pt[],
  vx: Float64Array,
  vy: Float64Array,
  tmpX: Float64Array,
  tmpY: Float64Array
): number {
  vx[0] = i; vy[0] = j;
  vx[1] = i + 1; vy[1] = j;
  vx[2] = i + 1; vy[2] = j + 1;
  vx[3] = i; vy[3] = j + 1;
  const n = clipConvexInPlace(vx, vy, 4, clip, tmpX, tmpY);
  if (n < 3) return 0;

  const SNAP = 100;
  let m = 0;
  for (let v = 0; v < n; v++) {
    const sx = Math.round(vx[v] * SNAP) / SNAP;
    const sy = Math.round(vy[v] * SNAP) / SNAP;
    if (m > 0 && sx === vx[m - 1] && sy === vy[m - 1]) continue;
    vx[m] = sx;
    vy[m] = sy;
    m++;
  }
  while (m > 1 && vx[m - 1] === vx[0] && vy[m - 1] === vy[0]) m--;
  if (m < 3) return 0;
  if (Math.abs(polygonArea(vx, vy, m)) < 1e-3) return 0;
  return m;
}

/** Move each edge of a convex CCW polygon inward by `d`, rebuilding corners */
export function insetConvex(poly: Pt[], d: number): Pt[] {
  const n = poly.length;
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // inward normal for CCW polygon is the left of the edge direction
    const nx = -dy / len;
    const ny = dx / len;
    lines.push({ px: a.x + nx * d, py: a.y + ny * d, dx, dy });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n];
    const l2 = lines[i];
    const det = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(det) < EPS) {
      out.push({ x: l2.px, y: l2.py });
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
    out.push({ x: l1.px + t * l1.dx, y: l1.py + t * l1.dy });
  }
  return out;
}

/**
 * Clip polylines (flat [x0,y0,x1,y1,...] with break indices) to a convex
 * polygon; returns chains of points, with exact entry/exit points on the
 * boundary. Chains never bridge input breaks.
 */
export function clipPolylinesToConvex(
  pts: Float32Array,
  breaks: Uint32Array,
  poly: Pt[]
): { x: number; y: number }[][] {
  const chains: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  const breakSet = new Set(breaks);
  const total = pts.length / 2;

  const flush = () => {
    if (current.length >= 2) chains.push(current);
    current = [];
  };

  for (let p = 1; p < total; p++) {
    if (breakSet.has(p)) {
      flush();
      continue;
    }
    const x0 = pts[(p - 1) * 2];
    const y0 = pts[(p - 1) * 2 + 1];
    const x1 = pts[p * 2];
    const y1 = pts[p * 2 + 1];
    // parametric clip of segment against all half-planes (Cyrus–Beck)
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (let e = 0; e < poly.length && ok; e++) {
      const a = poly[e];
      const b = poly[(e + 1) % poly.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const d0 = ex * (y0 - a.y) - ey * (x0 - a.x);
      const d1 = ex * (y1 - a.y) - ey * (x1 - a.x);
      const dd = d1 - d0;
      if (Math.abs(dd) < EPS) {
        if (d0 < -EPS) ok = false;
        continue;
      }
      const t = -d0 / dd;
      if (dd > 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) ok = false;
    }
    if (!ok) {
      flush();
      continue;
    }
    const ax = x0 + t0 * (x1 - x0);
    const ay = y0 + t0 * (y1 - y0);
    const bx = x0 + t1 * (x1 - x0);
    const by = y0 + t1 * (y1 - y0);
    if (t0 > EPS || current.length === 0) {
      flush();
      current.push({ x: ax, y: ay });
    }
    current.push({ x: bx, y: by });
    if (t1 < 1 - EPS) flush();
  }
  flush();
  return chains;
}
