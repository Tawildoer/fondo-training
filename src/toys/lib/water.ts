import { toLocal, type TileFrame } from './projection';

type LonLat = { lat: number; lon: number };

type OverpassElement = {
  type: 'way' | 'relation';
  geometry?: LonLat[];
  members?: { type: string; role: string; geometry?: LonLat[] }[];
};

export type WaterPolygon = {
  outer: LonLat[][];
  inner: LonLat[][];
};

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Water polygons depend only on the tile bounds — never on grid resolution —
 * so cache them per bounds. Changing the detail slider must not re-hit
 * Overpass (bursts get rate-limited and water would vanish).
 */
const polygonCache = new Map<string, WaterPolygon[]>();

/**
 * Fetch water polygons (lakes, rivers, reservoirs) intersecting the tile
 * bounds from OpenStreetMap. Ocean is handled separately via elevation <= 0.
 */
export async function fetchWaterPolygons(frame: TileFrame): Promise<WaterPolygon[]> {
  const { south, west, north, east } = frame.bounds;
  const bbox = `${south},${west},${north},${east}`;
  const cached = polygonCache.get(bbox);
  if (cached) return cached;
  const query = `
[out:json][timeout:45];
(
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["waterway"="riverbank"](${bbox});
  relation["waterway"="riverbank"](${bbox});
);
out geom;`;

  // Overpass rate-limits bursts (multi-day fetches); retry with backoff
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (res.ok) break;
    if (res.status !== 429 && res.status < 500) break; // not retryable
  }
  if (!res || !res.ok) throw new Error(`Overpass request failed (${res?.status})`);
  const json = (await res.json()) as { elements?: OverpassElement[]; remark?: string };
  // Overpass reports server-side query timeouts as 200 + "remark" with no
  // data — treat as failure so it retries instead of silently losing water
  if (!json.elements?.length && json.remark) {
    throw new Error(`Overpass: ${json.remark}`);
  }

  const polygons: WaterPolygon[] = [];
  for (const el of json.elements ?? []) {
    if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      polygons.push({ outer: [el.geometry], inner: [] });
    } else if (el.type === 'relation' && el.members) {
      const outers = assembleRings(
        el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry!)
      );
      const inners = assembleRings(
        el.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry!)
      );
      if (outers.length) polygons.push({ outer: outers, inner: inners });
    }
  }
  if (polygonCache.size > 60) polygonCache.clear();
  polygonCache.set(bbox, polygons);
  return polygons;
}

/**
 * Stitch way segments into closed rings by chaining matching endpoints.
 * OSM multipolygon outers/inners are often split across several ways.
 */
function assembleRings(segments: LonLat[][]): LonLat[][] {
  const key = (p: LonLat) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const pool = segments.map((s) => [...s]);
  const rings: LonLat[][] = [];

  while (pool.length) {
    const ring = pool.pop()!;
    let extended = true;
    while (extended && key(ring[0]) !== key(ring[ring.length - 1])) {
      extended = false;
      const tail = key(ring[ring.length - 1]);
      for (let i = 0; i < pool.length; i++) {
        const seg = pool[i];
        if (key(seg[0]) === tail) {
          ring.push(...seg.slice(1));
        } else if (key(seg[seg.length - 1]) === tail) {
          ring.push(...seg.slice(0, -1).reverse());
        } else {
          continue;
        }
        pool.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) {
      rings.push(ring);
    }
  }
  return rings;
}

/**
 * Rasterize water polygons onto the cell grid via an offscreen canvas.
 * Returns a per-cell 0/1 mask (cellsX * cellsY, row-major, y=0 = south).
 */
export function rasterizeWater(
  polygons: WaterPolygon[],
  frame: TileFrame,
  cellsX: number,
  cellsY: number
): Uint8Array {
  const canvas = new OffscreenCanvas(cellsX, cellsY);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cellsX, cellsY);
  ctx.fillStyle = '#fff';

  const sx = cellsX / frame.widthMeters;
  const sy = cellsY / frame.heightMeters;

  const tracePath = (path: Path2D, ring: LonLat[]) => {
    ring.forEach((p, i) => {
      const [mx, my] = toLocal(frame, p.lon, p.lat);
      // canvas y grows downward; our grid y=0 is south
      const cx = mx * sx;
      const cy = cellsY - my * sy;
      if (i === 0) path.moveTo(cx, cy);
      else path.lineTo(cx, cy);
    });
    path.closePath();
  };

  for (const poly of polygons) {
    const path = new Path2D();
    for (const ring of poly.outer) tracePath(path, ring);
    for (const ring of poly.inner) tracePath(path, ring);
    ctx.fill(path, 'evenodd');
  }

  const img = ctx.getImageData(0, 0, cellsX, cellsY);
  const mask = new Uint8Array(cellsX * cellsY);
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      // flip back: canvas row 0 = north, mask row 0 = south
      const canvasO = ((cellsY - 1 - j) * cellsX + i) * 4;
      mask[j * cellsX + i] = img.data[canvasO] > 127 ? 1 : 0;
    }
  }
  return mask;
}
