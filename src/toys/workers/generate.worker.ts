import type { Marker } from '../lib/marker';
import { buildModel } from '../lib/pipeline';
import type { Body, EleRange, ModelStats, RawTerrain, TileParams } from '../lib/types';

export type GenerateDay = {
  raw: RawTerrain;
  distanceKm: number;
};

export type GenerateRequest = {
  seq: number;
  days: GenerateDay[];
  params: TileParams;
  /** Trip-wide elevation range for multi-day consistency */
  eleOverride?: EleRange;
  /** Selected climb-marker summits (lat/lon) */
  markers?: Marker[];
};

export type GeneratedTile = { bodies: Body[]; stats: ModelStats };

export type GenerateResponse =
  | { seq: number; ok: true; tiles: GeneratedTile[] }
  | { seq: number; ok: false; error: string };

const post = self.postMessage.bind(self) as (msg: GenerateResponse, transfer?: Transferable[]) => void;

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { seq, days, params, eleOverride, markers } = e.data;
  try {
    const tiles = days.map((day) =>
      buildModel(day.raw, params, day.distanceKm, eleOverride, markers)
    );
    const transfer = tiles.flatMap((t) =>
      t.bodies.flatMap((b) =>
        b.normals ? [b.positions.buffer, b.normals.buffer] : [b.positions.buffer]
      )
    ) as Transferable[];
    post({ seq, ok: true, tiles }, transfer);
  } catch (err) {
    post({ seq, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
