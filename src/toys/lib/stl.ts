import type { Body, BodyName } from './types';

/** Filenames sort in a sensible slicer part order */
export const STL_FILENAMES: Record<BodyName, string> = {
  base: '01-base.stl',
  water: '02-water.stl',
  grass: '03-land.stl',
  rock: '04-rock.stl',
  snow: '05-snow.stl',
  route: '06-route.stl',
  marker: '07-marker-sockets-NEGATIVE.stl',
};

/**
 * Binary STL (mm units). All of a tile's bodies share the same coordinate
 * system, so importing them together as one multi-part object restores the
 * exact relative positions — the universal multi-color workflow: any slicer,
 * one filament assigned per part by the user.
 */
export function writeStlBinary(body: Body, name: string): Uint8Array {
  const pos = body.positions;
  const nrm = body.normals;
  const tris = pos.length / 9;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);

  const header = `RouteTile ${name}`;
  for (let i = 0; i < 80; i++) {
    dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  }
  dv.setUint32(80, tris, true);

  let o = 84;
  for (let t = 0; t < tris; t++) {
    const p = t * 9;
    let nx: number, ny: number, nz: number;
    if (nrm) {
      nx = nrm[p];
      ny = nrm[p + 1];
      nz = nrm[p + 2];
    } else {
      const ux = pos[p + 3] - pos[p];
      const uy = pos[p + 4] - pos[p + 1];
      const uz = pos[p + 5] - pos[p + 2];
      const vx = pos[p + 6] - pos[p];
      const vy = pos[p + 7] - pos[p + 1];
      const vz = pos[p + 8] - pos[p + 2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
    }
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    for (let v = 0; v < 9; v++) {
      dv.setFloat32(o + 12 + v * 4, pos[p + v], true);
    }
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return new Uint8Array(buf);
}
