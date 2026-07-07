import { pointInConvex } from './clip';
import { mercX, mercY } from './projection';
import { routeStations } from './ribbon';
import { hexagonCorners } from './shape';
import type { Body, RawTerrain, TileParams } from './types';

export type Marker = { lat: number; lon: number };

/** Pocket depth into the pedestal (mm); the plug matches it */
export const SOCKET_DEPTH = 2.4;
/** Radial press-fit clearance between plug and pocket (mm) */
export const PLUG_CLEARANCE = 0.12;
const SEGMENTS = 24;

export type MarkerFeatures = {
  /** Ribbon cutouts (tile-local meters): the route stops at the pedestal */
  cutouts: { x: number; y: number; r: number }[];
  /** Pedestal solids (mm) to merge into the route body */
  pedestals: Float32Array;
  /** Per-cell terrain cap (mm, NaN = uncapped): keeps terrain out of pockets */
  caps: Float64Array;
  /** Preview-only red plugs for the viewer (excluded from exports) */
  preview: Body;
};

/**
 * Climb markers as real geometry — the main print gets actual holes:
 * each selected summit becomes a cylindrical pedestal merged into the route
 * body (an orange medallion where the route swells into a pad) with a blind
 * pocket modeled into its top. The route ribbon is interrupted under the
 * pedestal and the terrain is capped below the pocket floor, so no other
 * solid refills the hole. The separately printed plug glues into the pocket.
 */
export function buildMarkerFeatures(
  raw: RawTerrain,
  params: TileParams,
  markers: Marker[]
): MarkerFeatures | null {
  if (!markers.length) return null;
  const { cellsX, cellsY, heights, widthMeters, heightMeters, minEle, bounds } = raw;
  const nx = cellsX + 1;
  const cellM = widthMeters / cellsX;
  const scaleXY = params.tileWidthMM / widthMeters;
  const scaleZ = scaleXY * params.verticalExaggeration;
  const zBase = params.baseThicknessMM;
  const zOf = (ele: number) => zBase + 0.4 + (ele - minEle) * scaleZ;
  const cellMM = cellM * scaleXY;

  const rIn = params.markerDiameterMM / 2;
  // pedestal wall must hide the cell-blocky terrain cap at any resolution
  const wall = Math.max(1.2, cellMM * Math.SQRT2 + 0.3);
  const rOut = rIn + wall;

  const originX = mercX(bounds.west);
  const originY = mercY(bounds.south);
  const k = widthMeters / (mercX(bounds.east) - originX);
  const toLocal = (lon: number, lat: number): [number, number] => [
    (mercX(lon) - originX) * k,
    (mercY(lat) - originY) * k,
  ];

  const hexPoly = params.shape === 'hexagon' ? hexagonCorners(widthMeters, heightMeters) : null;
  const insideTile = (x: number, y: number) =>
    x >= 0 && x <= widthMeters && y >= 0 && y <= heightMeters && (!hexPoly || pointInConvex(hexPoly, x, y));

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

  const stations = routeStations(raw, params).flat();
  const rOutM = rOut / scaleXY;

  const cutouts: { x: number; y: number; r: number }[] = [];
  const pedestals: number[] = [];
  const preview: number[] = [];
  const caps = new Float64Array(cellsX * cellsY).fill(NaN);

  for (const marker of markers) {
    const [mx, my] = toLocal(marker.lon, marker.lat);
    if (!insideTile(mx, my)) continue;

    // snap onto the route where possible
    let cx = mx;
    let cy = my;
    let refTop = zOf(eleAt(mx, my)) + params.ridgeHeightMM;
    let bestD = Infinity;
    let best = -1;
    for (let s = 0; s < stations.length; s++) {
      const d = (stations[s].x - mx) ** 2 + (stations[s].y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    const snapM = Math.max((params.routeWidthMM * 4) / scaleXY, cellM * 3);
    if (best >= 0 && bestD < snapM * snapM) {
      const st = stations[best];
      cx = st.x;
      cy = st.y;
      refTop =
        params.ridgeHeightMM > 0
          ? zOf(st.bed) + params.ridgeHeightMM
          : Math.max(zOf(st.ele), zOf(st.bed)) + 0.15;
    }

    // pedestal top clears every bit of terrain inside its footprint, so the
    // pocket rim is always exposed
    let maxEleLocal = eleAt(cx, cy);
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * Math.PI * 2;
      for (const rr of [rOutM * 0.55, rOutM]) {
        maxEleLocal = Math.max(maxEleLocal, eleAt(cx + rr * Math.cos(a), cy + rr * Math.sin(a)));
      }
    }
    // pedestal must clear local terrain AND be tall enough for a full-depth
    // pocket with solid material beneath the floor (never cut into the base)
    const topZ = Math.max(refTop, zOf(maxEleLocal) + 0.3, zBase + SOCKET_DEPTH + 0.8);
    const zF = topZ - SOCKET_DEPTH;

    cutouts.push({ x: cx, y: cy, r: rOutM });
    pocketPedestal(pedestals, cx * scaleXY, cy * scaleXY, zBase, topZ, zF, rIn, rOut);
    cylinder(preview, cx * scaleXY, cy * scaleXY, zF, topZ + 0.4, rIn - PLUG_CLEARANCE);

    // cap terrain below the pocket floor wherever a cell overlaps the pocket
    const capZ = Math.max(zF - 0.15, zBase + 0.1);
    const capR = rIn / scaleXY + cellM * Math.SQRT1_2;
    const ci0 = Math.max(0, Math.floor((cx - capR) / cellM - 1));
    const ci1 = Math.min(cellsX - 1, Math.ceil((cx + capR) / cellM + 1));
    const cj0 = Math.max(0, Math.floor((cy - capR) / cellM - 1));
    const cj1 = Math.min(cellsY - 1, Math.ceil((cy + capR) / cellM + 1));
    for (let j = cj0; j <= cj1; j++) {
      for (let i = ci0; i <= ci1; i++) {
        const dx = (i + 0.5) * cellM - cx;
        const dy = (j + 0.5) * cellM - cy;
        if (dx * dx + dy * dy <= capR * capR) {
          const c = j * cellsX + i;
          caps[c] = Number.isNaN(caps[c]) ? capZ : Math.min(caps[c], capZ);
        }
      }
    }
  }

  if (cutouts.length === 0) return null;
  return {
    cutouts,
    pedestals: new Float32Array(pedestals),
    caps,
    preview: { name: 'marker', positions: new Float32Array(preview) },
  };
}

/** The press-fit plug to print separately (e.g. in red) and glue in */
export function markerPlug(params: TileParams): Body {
  const tris: number[] = [];
  cylinder(tris, 0, 0, 0, SOCKET_DEPTH, params.markerDiameterMM / 2 - PLUG_CLEARANCE);
  return { name: 'marker', positions: new Float32Array(tris) };
}

/**
 * Watertight pedestal with a blind pocket: bottom disc, outer wall, top
 * annulus, inward pocket wall, pocket floor (facing up).
 */
function pocketPedestal(
  out: number[],
  cx: number,
  cy: number,
  zBase: number,
  topZ: number,
  zF: number,
  rIn: number,
  rOut: number
) {
  const ox: number[] = [];
  const oy: number[] = [];
  const ix: number[] = [];
  const iy: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    ox.push(cx + rOut * Math.cos(a));
    oy.push(cy + rOut * Math.sin(a));
    ix.push(cx + rIn * Math.cos(a));
    iy.push(cy + rIn * Math.sin(a));
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const q = (s + 1) % SEGMENTS;
    // outer wall, outward
    out.push(ox[s], oy[s], zBase, ox[q], oy[q], zBase, ox[q], oy[q], topZ);
    out.push(ox[s], oy[s], zBase, ox[q], oy[q], topZ, ox[s], oy[s], topZ);
    // top annulus (up)
    out.push(ox[s], oy[s], topZ, ox[q], oy[q], topZ, ix[q], iy[q], topZ);
    out.push(ox[s], oy[s], topZ, ix[q], iy[q], topZ, ix[s], iy[s], topZ);
    // pocket wall, facing inward (reverse ring direction)
    out.push(ix[q], iy[q], zF, ix[s], iy[s], zF, ix[s], iy[s], topZ);
    out.push(ix[q], iy[q], zF, ix[s], iy[s], topZ, ix[q], iy[q], topZ);
  }
  for (let s = 1; s < SEGMENTS - 1; s++) {
    // pocket floor (up) and bottom disc (down)
    out.push(ix[0], iy[0], zF, ix[s], iy[s], zF, ix[s + 1], iy[s + 1], zF);
    out.push(ox[0], oy[0], zBase, ox[s + 1], oy[s + 1], zBase, ox[s], oy[s], zBase);
  }
}

/** Watertight closed cylinder, CCW ring, outward walls */
function cylinder(out: number[], cx: number, cy: number, z0: number, z1: number, r: number) {
  const px: number[] = [];
  const py: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    px.push(cx + r * Math.cos(a));
    py.push(cy + r * Math.sin(a));
  }
  for (let s = 1; s < SEGMENTS - 1; s++) {
    out.push(px[0], py[0], z1, px[s], py[s], z1, px[s + 1], py[s + 1], z1);
    out.push(px[0], py[0], z0, px[s + 1], py[s + 1], z0, px[s], py[s], z0);
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const q = (s + 1) % SEGMENTS;
    out.push(px[s], py[s], z0, px[q], py[q], z0, px[q], py[q], z1);
    out.push(px[s], py[s], z0, px[q], py[q], z1, px[s], py[s], z1);
  }
}
