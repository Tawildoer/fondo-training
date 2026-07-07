import type { TrackPoint } from './types';

/**
 * Synthetic demo route: a hilly loop on the east shore of Lake Annecy
 * (France), chosen because the tile contains a large lake, green valley
 * floor, and 2000m+ peaks — every color class exercised without a FIT file.
 */
export function demoTrack(): TrackPoint[] {
  const points: TrackPoint[] = [];
  const cLat = 45.845;
  const cLon = 6.225;
  const n = 400;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    // Wobbly loop hugging the shore on the west side, climbing east
    const r = 1 + 0.18 * Math.sin(3 * t) + 0.08 * Math.sin(7 * t + 1.3);
    points.push({
      lat: cLat + 0.028 * r * Math.sin(t),
      lon: cLon + 0.030 * r * Math.cos(t),
      // synthetic profile: two big climbs and a small one, so the
      // climb-marker feature is demonstrable without a real file
      ele: 450 + 600 * Math.max(0, Math.sin(t * 2 - 0.4)) + 180 * Math.max(0, Math.sin(t * 5)),
    });
  }
  return points;
}
