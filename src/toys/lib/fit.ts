import FitParser from 'fit-file-parser';
import type { TrackPoint } from './types';

type FitRecord = {
  position_lat?: number;
  position_long?: number;
  altitude?: number;
  enhanced_altitude?: number;
};

/**
 * Parse a FIT file into GPS track points. fit-file-parser converts
 * semicircles to degrees for us. Records without a position (paused,
 * indoor, dropout) are skipped.
 */
export async function parseFit(buffer: ArrayBuffer): Promise<TrackPoint[]> {
  const parser = new FitParser({
    force: true,
    speedUnit: 'km/h',
    lengthUnit: 'm',
    elapsedRecordField: true,
    mode: 'list',
  });

  const data = await new Promise<{ records?: FitRecord[] }>((resolve, reject) => {
    parser.parse(buffer, (err, parsed) => {
      if (err) reject(new Error(err));
      else resolve(parsed as { records?: FitRecord[] });
    });
  });

  const points: TrackPoint[] = [];
  for (const r of data.records ?? []) {
    const lat = r.position_lat;
    const lon = r.position_long;
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      !isFinite(lat) ||
      !isFinite(lon) ||
      (lat === 0 && lon === 0)
    ) {
      continue;
    }
    points.push({ lat, lon, ele: r.enhanced_altitude ?? r.altitude });
  }

  if (points.length < 2) {
    throw new Error(
      'No GPS track found in this FIT file — it may be an indoor activity or missing position data.'
    );
  }
  return points;
}

/** Total track distance in km (haversine) */
export function trackDistanceKm(track: TrackPoint[]): number {
  const R = 6371;
  let d = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    d += 2 * R * Math.asin(Math.sqrt(s));
  }
  return d;
}
