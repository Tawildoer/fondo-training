import type { Bounds, TrackPoint } from './types';

const R = 6378137; // WGS84 / Web Mercator radius
export const EARTH_CIRCUMFERENCE = 2 * Math.PI * R;

/** Web Mercator projection (meters, unscaled) */
export function mercX(lonDeg: number): number {
  return R * ((lonDeg * Math.PI) / 180);
}

export function mercY(latDeg: number): number {
  const lat = (latDeg * Math.PI) / 180;
  return R * Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

export function invMercLat(y: number): number {
  return ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI;
}

export function invMercLon(x: number): number {
  return ((x / R) * 180) / Math.PI;
}

/**
 * Tile-local frame: Web Mercator meters scaled by cos(centerLat) so
 * distances are approximately true meters, with origin at the tile's
 * south-west corner. x grows east, y grows north.
 */
export type TileFrame = {
  bounds: Bounds;
  /** Mercator coords of the SW corner (unscaled) */
  originX: number;
  originY: number;
  /** cos(center latitude) — mercator→meters correction */
  k: number;
  widthMeters: number;
  heightMeters: number;
};

/** Padded route bbox in raw mercator: center + span */
export type PaddedSpan = { cx: number; cy: number; spanX: number; spanY: number };

export function paddedSpan(track: TrackPoint[], paddingPct: number, square: boolean): PaddedSpan {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of track) {
    const x = mercX(p.lon);
    const y = mercY(p.lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const pad = 1 + (2 * paddingPct) / 100;
  let spanX = Math.max(maxX - minX, 1) * pad;
  let spanY = Math.max(maxY - minY, 1) * pad;
  if (square) {
    spanX = spanY = Math.max(spanX, spanY);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, spanX, spanY };
}

/** Build a tile frame from a mercator center + span */
export function frameFromSpan(cx: number, cy: number, spanX: number, spanY: number): TileFrame {
  const minX = cx - spanX / 2;
  const maxX = cx + spanX / 2;
  const minY = cy - spanY / 2;
  const maxY = cy + spanY / 2;
  const centerLat = invMercLat(cy);
  const k = Math.cos((centerLat * Math.PI) / 180);

  return {
    bounds: {
      west: invMercLon(minX),
      east: invMercLon(maxX),
      south: invMercLat(minY),
      north: invMercLat(maxY),
    },
    originX: minX,
    originY: minY,
    k,
    widthMeters: spanX * k,
    heightMeters: spanY * k,
  };
}

/** Project lon/lat into tile-local meters */
export function toLocal(frame: TileFrame, lonDeg: number, latDeg: number): [number, number] {
  return [
    (mercX(lonDeg) - frame.originX) * frame.k,
    (mercY(latDeg) - frame.originY) * frame.k,
  ];
}

/** Slippy-map tile x/y for a lon/lat at zoom z */
export function lonLatToTile(lonDeg: number, latDeg: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((lonDeg + 180) / 360) * n;
  const lat = (latDeg * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  return [x, y];
}
