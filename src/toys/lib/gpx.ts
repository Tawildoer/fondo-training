import type { TrackPoint } from './types';

/**
 * Parse a GPX file into GPS track points. Reads every <trkpt> across all
 * tracks/segments (falling back to route points <rtept> for route-only files).
 */
export function parseGpx(text: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Not a valid GPX file.');
  }

  let nodes = doc.getElementsByTagName('trkpt');
  if (nodes.length === 0) nodes = doc.getElementsByTagName('rtept');

  const points: TrackPoint[] = [];
  for (const node of Array.from(nodes)) {
    const lat = Number(node.getAttribute('lat'));
    const lon = Number(node.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const eleText = node.getElementsByTagName('ele')[0]?.textContent;
    const ele = eleText ? Number(eleText) : undefined;
    points.push({ lat, lon, ele: isFinite(ele ?? NaN) ? ele : undefined });
  }

  if (points.length < 2) {
    throw new Error('No GPS track found in this GPX file.');
  }
  return points;
}
