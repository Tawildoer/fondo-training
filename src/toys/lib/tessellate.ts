import { mercX, mercY } from './projection';
import type { TileShape } from './shape';
import type { TrackPoint } from './types';

/** One tile of the trip tessellation: mercator center of the cell */
export type TileCell = { cx: number; cy: number };

/**
 * Lay a regular grid (squares or pointy-top hexagons) over the mercator
 * plane and return every cell the route passes through — in first-visit
 * order, so tile numbering follows the journey. Adjacent cells share exact
 * edges, so terrain and route continue seamlessly across printed tiles.
 *
 * The grid anchor is a free parameter, so it is optimized: among candidate
 * grid offsets, pick the one using the fewest tiles, tie-broken by the most
 * even spread of route across tiles (maximize the smallest per-tile share) —
 * no tile should carry only a sliver of the ride.
 *
 * Tracks are handled as separate polylines: the gap between one day's end
 * and the next day's start is never bridged (no phantom route or tiles).
 *
 * Performance contract: real rides carry tens of thousands of GPS points,
 * and the tile-count span search evaluates this dozens of times — so the
 * route is resampled to a bounded number of points (never per-GPS-point)
 * and the hot counting loops use packed integer cell keys, no strings.
 */
export function tessellate(
  tracks: TrackPoint[][],
  spanX: number,
  spanY: number,
  shape: TileShape
): TileCell[] {
  return tessellateImpl(tracks, spanX, spanY, shape, 12, 64);
}

/**
 * Tile count for a candidate tile size — used by the span search that hits
 * a requested tile count. `fine` runs at exactly the final tessellation's
 * resolution so the search result always matches the produced layout;
 * coarse is for cheap bracketing.
 */
export function countCells(
  tracks: TrackPoint[][],
  spanX: number,
  spanY: number,
  shape: TileShape,
  fine = false
): number {
  return fine
    ? tessellateImpl(tracks, spanX, spanY, shape, 12, 64).length
    : tessellateImpl(tracks, spanX, spanY, shape, 6, 24).length;
}

/** Pack signed cell indices into one number (±8191 cells is ample) */
const PACK = 16384;
const packKey = (i: number, j: number) => (i + PACK / 2) * PACK + (j + PACK / 2);

type Indexer = {
  /** packed cell key for a mercator point */
  key: (x: number, y: number) => number;
  /** cell center from a packed key */
  center: (key: number) => TileCell;
};

function tessellateImpl(
  tracks: TrackPoint[][],
  spanX: number,
  spanY: number,
  shape: TileShape,
  anchorSteps: number,
  densifyDiv: number
): TileCell[] {
  const pts = densify(tracks, spanX, spanY, densifyDiv);
  const n = pts.length / 2;

  // base anchor: trip bbox center
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let p = 0; p < n; p++) {
    const x = pts[p * 2];
    const y = pts[p * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const ax0 = (minX + maxX) / 2;
  const ay0 = (minY + maxY) / 2;

  const makeIndexer = (ax: number, ay: number): Indexer =>
    shape === 'hexagon' ? hexIndexer(ax, ay, spanX, spanY) : squareIndexer(ax, ay, spanX, spanY);

  // Anchor search over one full grid period
  const periodX = spanX;
  const periodY = shape === 'hexagon' ? 1.5 * spanY : spanY; // hex rows repeat every 2 rows
  let bestAx = ax0;
  let bestAy = ay0;
  let bestCount = Infinity;
  let bestMinShare = -1;
  const counts = new Map<number, number>();
  for (let ix = 0; ix < anchorSteps; ix++) {
    for (let iy = 0; iy < anchorSteps; iy++) {
      const ax = ax0 + (ix / anchorSteps) * periodX;
      const ay = ay0 + (iy / anchorSteps) * periodY;
      const { key } = makeIndexer(ax, ay);
      counts.clear();
      for (let p = 0; p < n; p++) {
        const k = key(pts[p * 2], pts[p * 2 + 1]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const count = counts.size;
      if (count > bestCount) continue;
      let minCount = Infinity;
      for (const c of counts.values()) if (c < minCount) minCount = c;
      const minShare = minCount / n;
      if (count < bestCount || minShare > bestMinShare) {
        bestCount = count;
        bestMinShare = minShare;
        bestAx = ax;
        bestAy = ay;
      }
    }
  }

  // Final assignment with the winning anchor, in first-visit order
  const { key, center } = makeIndexer(bestAx, bestAy);
  const seen = new Set<number>();
  const cells: TileCell[] = [];
  for (let p = 0; p < n; p++) {
    const k = key(pts[p * 2], pts[p * 2 + 1]);
    if (!seen.has(k)) {
      seen.add(k);
      cells.push(center(k));
    }
  }
  return cells;
}

/**
 * Route resampled into mercator points in journey order, without bridging
 * between tracks. Sample spacing is ~1/div of a tile (so no crossed cell is
 * skipped), floored so the total stays under ~4k points however dense the
 * GPS recording is.
 */
function densify(
  tracks: TrackPoint[][],
  spanX: number,
  spanY: number,
  div: number
): Float64Array {
  // project once & measure total length
  const proj: Float64Array[] = tracks.map((track) => {
    const a = new Float64Array(track.length * 2);
    for (let i = 0; i < track.length; i++) {
      a[i * 2] = mercX(track[i].lon);
      a[i * 2 + 1] = mercY(track[i].lat);
    }
    return a;
  });
  let totalLen = 0;
  for (const a of proj) {
    for (let i = 1; i < a.length / 2; i++) {
      totalLen += Math.hypot(a[i * 2] - a[i * 2 - 2], a[i * 2 + 1] - a[i * 2 - 1]);
    }
  }

  const step = Math.max(Math.min(spanX, spanY) / div, totalLen / 4000, 1e-6);
  const out: number[] = [];

  for (const a of proj) {
    const points = a.length / 2;
    if (points === 0) continue;
    out.push(a[0], a[1]);
    let carry = 0; // distance since the last emitted sample
    for (let i = 1; i < points; i++) {
      const x0 = a[i * 2 - 2];
      const y0 = a[i * 2 - 1];
      const x1 = a[i * 2];
      const y1 = a[i * 2 + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      let d = step - carry;
      let emitted = false;
      while (d <= len) {
        out.push(x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len);
        emitted = true;
        d += step;
      }
      carry = emitted ? len - (d - step) : carry + len;
    }
    // track endpoint always sampled (day boundaries matter)
    out.push(a[points * 2 - 2], a[points * 2 - 1]);
  }
  return Float64Array.from(out);
}

function squareIndexer(ax: number, ay: number, spanX: number, spanY: number): Indexer {
  return {
    key: (x, y) => packKey(Math.round((x - ax) / spanX), Math.round((y - ay) / spanY)),
    center: (k) => {
      const i = Math.floor(k / PACK) - PACK / 2;
      const j = (k % PACK) - PACK / 2;
      return { cx: ax + i * spanX, cy: ay + j * spanY };
    },
  };
}

/**
 * Pointy-top hexagon grid: horizontal period W (flat-to-flat), rows every
 * 1.5R vertically, odd rows shifted W/2. Test the three candidate rows.
 */
function hexIndexer(ax: number, ay: number, spanX: number, spanY: number): Indexer {
  const W = spanX;
  const R = spanY / 2;
  const rowH = 1.5 * R;
  const invSqrt3 = 1 / Math.sqrt(3);

  return {
    key: (x, y) => {
      const j0 = Math.round((y - ay) / rowH);
      let bestI = 0;
      let bestJ = j0;
      let bestDist = Infinity;
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        const off = (j & 1) !== 0 ? W / 2 : 0;
        const i = Math.round((x - ax - off) / W);
        const dx = Math.abs(x - (ax + i * W + off));
        const dy = Math.abs(y - (ay + j * rowH));
        if (dx <= W / 2 + 1e-9 && dy <= R - dx * invSqrt3 + 1e-9) {
          return packKey(i, j);
        }
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
      return packKey(bestI, bestJ); // numeric edge case: nearest candidate
    },
    center: (k) => {
      const i = Math.floor(k / PACK) - PACK / 2;
      const j = (k % PACK) - PACK / 2;
      const off = (j & 1) !== 0 ? W / 2 : 0;
      return { cx: ax + i * W + off, cy: ay + j * rowH };
    },
  };
}
