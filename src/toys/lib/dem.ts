import { lonLatToTile, type TileFrame, invMercLat, invMercLon } from './projection';

const TILE_SIZE = 256;
const TILE_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/**
 * Pick the tile zoom so the DEM pixel spacing is at least as fine as the
 * sampling grid. Terrarium tiles exist up to z15.
 */
export function pickZoom(frame: TileFrame, gridRes: number): number {
  const centerLat = (frame.bounds.south + frame.bounds.north) / 2;
  const targetMetersPerSample = frame.widthMeters / gridRes;
  // meters per DEM pixel at zoom z: 40075016 * cos(lat) / (256 * 2^z)
  const z = Math.ceil(
    Math.log2((40075016.686 * Math.cos((centerLat * Math.PI) / 180)) / (TILE_SIZE * targetMetersPerSample))
  );
  return Math.max(1, Math.min(14, z));
}

/**
 * Fetch + stitch terrarium tiles covering the frame, then bilinearly sample
 * vertex elevations for a (cellsX+1) x (cellsY+1) grid. Row-major, y=0 = south.
 */
export async function fetchHeights(
  frame: TileFrame,
  cellsX: number,
  cellsY: number
): Promise<Float32Array> {
  const z = pickZoom(frame, cellsX);
  const { west, east, south, north } = frame.bounds;

  const [txMinF, tyMinF] = lonLatToTile(west, north, z); // north = smaller tile y
  const [txMaxF, tyMaxF] = lonLatToTile(east, south, z);
  const txMin = Math.floor(txMinF);
  const tyMin = Math.floor(tyMinF);
  const txMax = Math.floor(txMaxF);
  const tyMax = Math.floor(tyMaxF);

  const cols = txMax - txMin + 1;
  const rows = tyMax - tyMin + 1;
  if (cols * rows > 64) {
    throw new Error('Terrain area too large — reduce padding or resolution.');
  }

  const canvas = new OffscreenCanvas(cols * TILE_SIZE, rows * TILE_SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  await Promise.all(
    Array.from({ length: cols * rows }, async (_, i) => {
      const tx = txMin + (i % cols);
      const ty = tyMin + Math.floor(i / cols);
      const res = await fetch(TILE_URL(z, tx, ty));
      if (!res.ok) throw new Error(`Elevation tile fetch failed (${res.status})`);
      const bitmap = await createImageBitmap(await res.blob());
      ctx.drawImage(bitmap, (tx - txMin) * TILE_SIZE, (ty - tyMin) * TILE_SIZE);
      bitmap.close();
    })
  );

  const img = ctx.getImageData(0, 0, cols * TILE_SIZE, rows * TILE_SIZE);
  const px = img.data;
  const imgW = cols * TILE_SIZE;
  const imgH = rows * TILE_SIZE;

  const eleAt = (ix: number, iy: number): number => {
    const cx = Math.max(0, Math.min(imgW - 1, ix));
    const cy = Math.max(0, Math.min(imgH - 1, iy));
    const o = (cy * imgW + cx) * 4;
    return px[o] * 256 + px[o + 1] + px[o + 2] / 256 - 32768;
  };

  const nx = cellsX + 1;
  const ny = cellsY + 1;
  const heights = new Float32Array(nx * ny);

  // Grid vertex (i,j): local meters -> lon/lat -> global pixel coords at zoom z
  const originXm = frame.originX;
  const originYm = frame.originY;
  const spanX = frame.widthMeters / frame.k; // back to raw mercator span
  const spanY = frame.heightMeters / frame.k;

  for (let j = 0; j < ny; j++) {
    const lat = invMercLat(originYm + (spanY * j) / cellsY);
    for (let i = 0; i < nx; i++) {
      const lon = invMercLon(originXm + (spanX * i) / cellsX);
      const [fx, fy] = lonLatToTile(lon, lat, z);
      // fractional pixel position within the stitched image
      const pxX = (fx - txMin) * TILE_SIZE - 0.5;
      const pxY = (fy - tyMin) * TILE_SIZE - 0.5;
      const x0 = Math.floor(pxX);
      const y0 = Math.floor(pxY);
      const dx = pxX - x0;
      const dy = pxY - y0;
      const e =
        eleAt(x0, y0) * (1 - dx) * (1 - dy) +
        eleAt(x0 + 1, y0) * dx * (1 - dy) +
        eleAt(x0, y0 + 1) * (1 - dx) * dy +
        eleAt(x0 + 1, y0 + 1) * dx * dy;
      heights[j * nx + i] = e;
    }
  }

  return heights;
}
