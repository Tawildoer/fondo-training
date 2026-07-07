import type { TrackPoint } from './types';

export type Climb = {
  /** Summit position (marker location) */
  lat: number;
  lon: number;
  gainM: number;
  lengthKm: number;
  gradePct: number;
  /** Distance from the trip start to the summit, km */
  atKm: number;
};

/**
 * Detect sustained climbs from the rides' own elevation profiles.
 * A climb runs from a local low to its running maximum; it ends when the
 * profile drops more than max(15 m, 30% of the gain so far) below that
 * maximum. Climbs under 60 m of gain are ignored. Returns up to 12,
 * biggest gain first.
 */
export function detectClimbs(tracks: TrackPoint[][]): Climb[] {
  const climbs: Climb[] = [];
  let tripKmBase = 0;

  for (const track of tracks) {
    const withEle = track.filter((p) => typeof p.ele === 'number' && isFinite(p.ele));
    if (withEle.length < track.length * 0.5 || withEle.length < 10) {
      tripKmBase += distanceKm(track, track.length - 1);
      continue; // no usable elevation in this ride
    }

    // cumulative distance + distance-smoothed elevation (~±150 m window)
    const n = track.length;
    const dist = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      dist[i] = dist[i - 1] + haversineM(track[i - 1], track[i]);
    }
    const ele = new Float64Array(n);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      while (dist[i] - dist[lo] > 150) lo++;
      while (hi < n - 1 && dist[hi + 1] - dist[i] < 150) hi++;
      let sum = 0;
      let count = 0;
      for (let k = lo; k <= hi; k++) {
        const e = track[k].ele;
        if (typeof e === 'number' && isFinite(e)) {
          sum += e;
          count++;
        }
      }
      ele[i] = count ? sum / count : ele[Math.max(0, i - 1)];
    }

    // climb state machine
    let start = 0;
    let maxIdx = 0;
    const close = () => {
      const gain = ele[maxIdx] - ele[start];
      const lenM = dist[maxIdx] - dist[start];
      if (gain >= 60 && lenM > 200) {
        climbs.push({
          lat: track[maxIdx].lat,
          lon: track[maxIdx].lon,
          gainM: gain,
          lengthKm: lenM / 1000,
          gradePct: (gain / lenM) * 100,
          atKm: tripKmBase + dist[maxIdx] / 1000,
        });
      }
    };
    for (let i = 1; i < n; i++) {
      if (ele[i] >= ele[maxIdx]) {
        maxIdx = i;
        continue;
      }
      const gain = ele[maxIdx] - ele[start];
      const drop = ele[maxIdx] - ele[i];
      if (drop > Math.max(15, gain * 0.3)) {
        close();
        start = i;
        maxIdx = i;
      } else if (ele[i] < ele[start]) {
        start = i;
        maxIdx = i;
      }
    }
    close();

    tripKmBase += dist[n - 1] / 1000;
  }

  climbs.sort((a, b) => b.gainM - a.gainM);
  return climbs.slice(0, 12);
}

function haversineM(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function distanceKm(track: TrackPoint[], toIdx: number): number {
  let d = 0;
  for (let i = 1; i <= toIdx && i < track.length; i++) d += haversineM(track[i - 1], track[i]);
  return d / 1000;
}
