import { CLASS, CLASS_NONE, type RawTerrain, type TileParams } from './types';

export type Classified = {
  /** Per-cell class code (CLASS.*) */
  cellClass: Uint8Array;
  /**
   * Per-cell flattened water level in meters (NaN where not flattened).
   * When set, all four corners of the cell's top face sit at this level.
   */
  flatLevel: Float32Array;
};

/**
 * Assign each cell a color class: water, then elevation bands split by the
 * rock/snow lines (as % of the tile's elevation range). The route is not a
 * cell class — it's a separate swept ribbon solid (lib/ribbon.ts) and the
 * terrain runs uninterrupted beneath it. `coverage` (0 = outside the tile
 * shape) marks cells as NONE.
 */
export function classifyCells(
  raw: RawTerrain,
  params: TileParams,
  coverage?: Uint8Array | null
): Classified {
  const { cellsX, cellsY, heights, waterMask, minEle, maxEle } = raw;
  const nx = cellsX + 1;
  const range = Math.max(maxEle - minEle, 1e-6);
  const rockEle = minEle + (params.rockLinePct / 100) * range;
  const snowEle = minEle + (params.snowLinePct / 100) * range;

  const cellClass = new Uint8Array(cellsX * cellsY);
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const c = j * cellsX + i;
      if (coverage && !coverage[c]) {
        cellClass[c] = CLASS_NONE;
        continue;
      }
      const mean =
        (heights[j * nx + i] +
          heights[j * nx + i + 1] +
          heights[(j + 1) * nx + i] +
          heights[(j + 1) * nx + i + 1]) /
        4;
      if (waterMask[c] || mean <= 0) {
        cellClass[c] = CLASS.water;
      } else if (mean >= snowEle) {
        cellClass[c] = CLASS.snow;
      } else if (mean >= rockEle) {
        cellClass[c] = CLASS.rock;
      } else {
        cellClass[c] = CLASS.grass;
      }
    }
  }

  resolveDiagonals(cellClass, cellsX, cellsY);

  const flatLevel = new Float32Array(cellsX * cellsY).fill(NaN);
  if (params.flattenWater) {
    flattenWaterBodies(raw, cellClass, flatLevel);
  }

  return { cellClass, flatLevel };
}

/**
 * Remove diagonal-only same-class contacts. Two cells of one class touching
 * only at a corner (both orthogonal neighbors different) make four wall
 * planes meet along one vertical edge — non-manifold geometry that slicers
 * flag for repair. Bridge one orthogonal neighbor into the class, or notch
 * a cell out at the tile rim where bridging would extend past the shape.
 */
function resolveDiagonals(cellClass: Uint8Array, cellsX: number, cellsY: number): void {
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let j = 0; j < cellsY - 1; j++) {
      for (let i = 0; i < cellsX - 1; i++) {
        const a = j * cellsX + i; // (i, j)
        const b = a + cellsX + 1; // (i+1, j+1)
        const p = a + 1; //          (i+1, j)
        const q = a + cellsX; //     (i, j+1)
        if (cellClass[a] === cellClass[b] && cellClass[a] !== CLASS_NONE) {
          if (cellClass[p] !== cellClass[a] && cellClass[q] !== cellClass[a]) {
            if (cellClass[p] !== CLASS_NONE) cellClass[p] = cellClass[a];
            else if (cellClass[q] !== CLASS_NONE) cellClass[q] = cellClass[a];
            else cellClass[b] = CLASS_NONE; // rim notch
            changed = true;
          }
        } else if (cellClass[p] === cellClass[q] && cellClass[p] !== CLASS_NONE) {
          if (cellClass[a] !== cellClass[p] && cellClass[b] !== cellClass[p]) {
            if (cellClass[a] !== CLASS_NONE) cellClass[a] = cellClass[p];
            else if (cellClass[b] !== CLASS_NONE) cellClass[b] = cellClass[p];
            else cellClass[q] = CLASS_NONE;
            changed = true;
          }
        }
      }
    }
    if (!changed) return;
  }
}

/**
 * Flood-fill connected water regions and pin each to a single level (the
 * minimum corner elevation in the region) so lakes print as flat surfaces.
 */
function flattenWaterBodies(raw: RawTerrain, cellClass: Uint8Array, flatLevel: Float32Array): void {
  const { cellsX, cellsY, heights } = raw;
  const nx = cellsX + 1;
  const visited = new Uint8Array(cellsX * cellsY);
  const stack: number[] = [];

  for (let start = 0; start < cellClass.length; start++) {
    if (cellClass[start] !== CLASS.water || visited[start]) continue;

    const component: number[] = [];
    let level = Infinity;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;

    while (stack.length) {
      const c = stack.pop()!;
      component.push(c);
      const i = c % cellsX;
      const j = (c / cellsX) | 0;
      level = Math.min(
        level,
        heights[j * nx + i],
        heights[j * nx + i + 1],
        heights[(j + 1) * nx + i],
        heights[(j + 1) * nx + i + 1]
      );
      if (i > 0) tryPush(c - 1);
      if (i < cellsX - 1) tryPush(c + 1);
      if (j > 0) tryPush(c - cellsX);
      if (j < cellsY - 1) tryPush(c + cellsX);
    }

    for (const c of component) flatLevel[c] = level;

    function tryPush(n: number) {
      if (!visited[n] && cellClass[n] === CLASS.water) {
        visited[n] = 1;
        stack.push(n);
      }
    }
  }
}
