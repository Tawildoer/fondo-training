export type TrackPoint = {
  lat: number;
  lon: number;
  ele?: number;
};

export const BODY_NAMES = ['base', 'water', 'grass', 'rock', 'snow', 'route', 'marker'] as const;
export type BodyName = (typeof BODY_NAMES)[number];

/** Cell classification codes used in TerrainGrid.cellClass */
export const CLASS = {
  water: 0,
  grass: 1,
  rock: 2,
  snow: 3,
  route: 4,
} as const;
export type CellClass = (typeof CLASS)[keyof typeof CLASS];

/** Cell outside the tile shape (e.g. beyond the hexagon edge) — emits no body */
export const CLASS_NONE = 255;

export const CLASS_TO_BODY: Record<CellClass, BodyName> = {
  [CLASS.water]: 'water',
  [CLASS.grass]: 'grass',
  [CLASS.rock]: 'rock',
  [CLASS.snow]: 'snow',
  [CLASS.route]: 'route',
};

export type TileParams = {
  /** Physical width of the tile in mm (X axis) */
  tileWidthMM: number;
  baseThicknessMM: number;
  /** Extra terrain around the route bounding box, as % of its size */
  paddingPct: number;
  /** Tile footprint shape; both tessellate so multi-tile trips assemble as a map */
  shape: 'square' | 'hexagon';
  /**
   * How many map tiles the trip should stretch over. Tile ground size is
   * solved to hit this count. The UI defaults it to the number of loaded
   * ride files whenever the ride list changes.
   */
  tileTarget: number;
  /** Number of grid cells across the tile width */
  gridRes: number;
  verticalExaggeration: number;
  /** Rock line as % of the tile's elevation range (green below) */
  rockLinePct: number;
  /** Snow line as % of the tile's elevation range (white above) */
  snowLinePct: number;
  /** Flatten each water body to a single level */
  flattenWater: boolean;
  routeWidthMM: number;
  /** 0 = flush inlay, >0 = raised ridge */
  ridgeHeightMM: number;
  /**
   * Path length (mm) over which a raised route's top is smoothed so it
   * doesn't serrate over steep terrain. 0 = exact drape. Ignored when flush.
   */
  routeSmoothMM: number;
  /** Diameter of climb-marker sockets/plugs (mm) */
  markerDiameterMM: number;
  colors: Record<BodyName, string>;
};

export const DEFAULT_PARAMS: TileParams = {
  tileWidthMM: 150,
  baseThicknessMM: 3,
  paddingPct: 15,
  shape: 'square',
  tileTarget: 1,
  gridRes: 240,
  verticalExaggeration: 1.6,
  rockLinePct: 55,
  snowLinePct: 82,
  flattenWater: true,
  routeWidthMM: 1.6,
  ridgeHeightMM: 0.8,
  routeSmoothMM: 8,
  markerDiameterMM: 4,
  colors: {
    base: '#3d3d3d',
    water: '#2f7fd4',
    grass: '#4c9a3f',
    rock: '#8b8b8b',
    snow: '#f2f2f2',
    route: '#ff7b1c',
    marker: '#dc2626',
  },
};

/**
 * Elevation range (meters) used for color thresholds and vertical scaling.
 * For multi-day sets this is the trip-wide range so every tile shares the
 * same snow line and z-scale and the set reads as one journey.
 */
export type EleRange = { min: number; max: number };

/** Geographic bounds in degrees */
export type Bounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/**
 * Everything fetched/derived from the network for a given
 * (track, padding, squareTile, gridRes) combination.
 */
export type RawTerrain = {
  /** Grid cells across (X) and down (Y) */
  cellsX: number;
  cellsY: number;
  /** Vertex elevations in meters, (cellsX+1) * (cellsY+1), row-major, y=0 = south */
  heights: Float32Array;
  /** Per-cell water flag (0/1), cellsX * cellsY */
  waterMask: Uint8Array;
  /** Tile footprint size in real-world meters */
  widthMeters: number;
  heightMeters: number;
  minEle: number;
  maxEle: number;
  bounds: Bounds;
  /** Route projected into tile-local meters (x east, y north), flat [x0,y0,x1,y1,...] */
  routeXY: Float32Array;
  /**
   * Point index where each ride/file starts within routeXY — the stroke
   * lifts the pen between rides so day gaps are never bridged.
   */
  routeBreaks: Uint32Array;
  /** True if water polygons were fetched OK (vs failed/empty) */
  waterOk: boolean;
};

/** One printable solid: non-indexed triangle soup in mm, Z up */
export type Body = {
  name: BodyName;
  positions: Float32Array;
  /** Optional precomputed face normals (matching positions layout) */
  normals?: Float32Array;
};

export type ModelStats = {
  widthMM: number;
  depthMM: number;
  heightMM: number;
  triangles: number;
  eleRangeM: number;
  distanceKm: number;
};
