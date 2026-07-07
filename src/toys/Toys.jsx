import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import ControlPanel from './ControlPanel'
import Viewer from './Viewer'
import { detectClimbs } from './lib/climbs'
import { demoTrack } from './lib/demo'
import { markerPlug } from './lib/marker'
import { parseFit, trackDistanceKm } from './lib/fit'
import { parseGpx } from './lib/gpx'
import { fetchTerrain, makeTripLayout } from './lib/pipeline'
import { writeBambu3MF } from './lib/bambu3mf'
import { STL_FILENAMES, writeStlBinary } from './lib/stl'
import { writeThreeMF } from './lib/threemf'
import { DEFAULT_PARAMS } from './lib/types'

/**
 * Make the multi-megabyte typed arrays non-enumerable so dev tooling that
 * serializes React props (React DevTools / performance tracks) never walks
 * them — stringifying a 2.5M-element Float32Array freezes the page for
 * seconds in dev mode. Property access still works normally.
 */
function shieldBody(body) {
  const out = { name: body.name }
  Object.defineProperty(out, 'positions', { value: body.positions, enumerable: false })
  Object.defineProperty(out, 'normals', { value: body.normals, enumerable: false })
  return out
}

/** Trip-wide elevation range so every tile shares thresholds + z-scale */
function globalEleRange(rawList) {
  return {
    min: Math.min(...rawList.map(r => r.minEle)),
    max: Math.max(...rawList.map(r => r.maxEle)),
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function newGenerateWorker() {
  return new Worker(new URL('./workers/generate.worker.ts', import.meta.url), { type: 'module' })
}

export default function Toys() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [rides, setRides] = useState([])
  const [layout, setLayout] = useState(null)
  const [rawList, setRawList] = useState(null)
  const [tileIndex, setTileIndex] = useState(0)
  const [viewMode, setViewMode] = useState('trip')
  /** Built tiles plus which layout tile index each one belongs to */
  const [built, setBuilt] = useState(null)
  const [status, setStatus] = useState(null)
  const [building, setBuilding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  /** bumped by the "retry water" button; failed water is never cached */
  const [waterRetry, setWaterRetry] = useState(0)
  const fetchSeq = useRef(0)
  // Terrain cache keyed by frame+resolution: retuning sliders or adding a
  // ride must not refetch unchanged tiles (Overpass rate-limits bursts)
  const terrainCache = useRef(new Map())

  const tripKm = useMemo(() => rides.reduce((s, r) => s + r.distanceKm, 0), [rides])

  // Major climbs detected from the rides' own elevation profiles; the user
  // ticks which summits get a marker socket (plus separately printed plug)
  const climbs = useMemo(() => detectClimbs(rides.map(r => r.track)), [rides])
  const [selectedClimbs, setSelectedClimbs] = useState([])
  const markers = useMemo(
    () => selectedClimbs.map(i => climbs[i]).filter(Boolean).map(c => ({ lat: c.lat, lon: c.lon })),
    [selectedClimbs, climbs]
  )

  // Geometry worker: one instance, jobs coalesced so a fast slider drag only
  // builds the newest state instead of queueing every intermediate value.
  const workerRef = useRef(null)
  const jobSeq = useRef(0)
  /** Tile indices of the job with seq === jobSeq.current */
  const jobTileIndices = useRef([])
  const workerBusy = useRef(false)
  const nextJob = useRef(null)

  useEffect(() => {
    const worker = newGenerateWorker()
    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.seq === jobSeq.current) {
        if (msg.ok) {
          setBuilt({
            tiles: msg.tiles.map(t => ({ ...t, bodies: t.bodies.map(shieldBody) })),
            tileIndices: jobTileIndices.current,
          })
        } else {
          setError(msg.error)
        }
      }
      if (nextJob.current) {
        const job = nextJob.current
        nextJob.current = null
        worker.postMessage(job)
      } else {
        workerBusy.current = false
        setBuilding(false)
      }
    }
    workerRef.current = worker
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  // Stage 1 (network): tessellate the trip and fetch terrain per tile
  const { paddingPct, gridRes, shape, tileTarget } = params
  useEffect(() => {
    if (rides.length === 0) return
    const seq = ++fetchSeq.current
    const timer = setTimeout(async () => {
      setError(null)
      try {
        const fetchParams = { ...DEFAULT_PARAMS, paddingPct, gridRes, shape, tileTarget }
        const tracks = rides.map(r => r.track)
        const nextLayout = makeTripLayout(tracks, fetchParams)
        const list = []
        for (let i = 0; i < nextLayout.frames.length; i++) {
          if (fetchSeq.current !== seq) return // superseded
          const f = nextLayout.frames[i]
          const trackLen = tracks.reduce((n, t) => n + t.length, 0)
          const key = `${f.originX.toFixed(1)},${f.originY.toFixed(1)},${f.widthMeters.toFixed(1)},${f.heightMeters.toFixed(1)},${gridRes},${trackLen}`
          const cached = terrainCache.current.get(key)
          if (cached) {
            list.push(cached)
            continue
          }
          setStatus(
            nextLayout.frames.length > 1
              ? `Fetching terrain — tile ${i + 1}/${nextLayout.frames.length}…`
              : 'Fetching elevation + water data…'
          )
          const fetched = await fetchTerrain(tracks, fetchParams, f)
          // never cache a tile whose water fetch failed — a transient
          // Overpass error must not lose water until page reload
          if (fetched.waterOk) {
            if (terrainCache.current.size > 40) terrainCache.current.clear()
            terrainCache.current.set(key, fetched)
          }
          list.push(fetched)
        }
        if (fetchSeq.current === seq) {
          setLayout(nextLayout)
          setRawList(list)
          setTileIndex(t => Math.min(t, list.length - 1))
          setStatus(null)
        }
      } catch (e) {
        if (fetchSeq.current === seq) {
          setStatus(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [rides, paddingPct, gridRes, shape, tileTarget, waterRetry])

  // Stage 2 (worker): rebuild solids on any change. Trip view builds every
  // tile; single view builds just the chosen one.
  useEffect(() => {
    if (!rawList || !layout || rawList.length !== layout.frames.length) return
    const tileIndices =
      viewMode === 'trip' || rawList.length === 1
        ? rawList.map((_, i) => i)
        : [Math.min(tileIndex, rawList.length - 1)]
    const timer = setTimeout(() => {
      jobSeq.current += 1
      jobTileIndices.current = tileIndices
      const job = {
        seq: jobSeq.current,
        days: tileIndices.map(i => ({ raw: rawList[i], distanceKm: tripKm })),
        params,
        eleOverride: globalEleRange(rawList),
        markers,
      }
      setBuilding(true)
      if (workerBusy.current) {
        nextJob.current = job // replace any older queued job
      } else {
        workerBusy.current = true
        workerRef.current?.postMessage(job)
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [rawList, layout, tileIndex, params, viewMode, tripKm, markers])

  const loadFiles = useCallback(async (files) => {
    setError(null)
    const added = []
    for (const file of files) {
      try {
        const isGpx = /\.gpx$/i.test(file.name)
        setStatus(`Parsing ${file.name}…`)
        const track = isGpx ? parseGpx(await file.text()) : await parseFit(await file.arrayBuffer())
        added.push({
          name: file.name.replace(/\.(fit|gpx)$/i, ''),
          track,
          distanceKm: trackDistanceKm(track),
        })
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setStatus(null)
    if (added.length) {
      setRawList(null) // avoid building against the outgoing layout
      setLayout(null)
      setSelectedClimbs([])
      const nextLen = rides.length + added.length
      setRides(prev => [...prev, ...added])
      // tile count defaults to one tile per ride file
      setParams(p => ({ ...p, tileTarget: nextLen }))
    }
  }, [rides.length])

  const removeRide = useCallback((index) => {
    setRawList(null)
    setLayout(null)
    setSelectedClimbs([])
    const nextLen = Math.max(1, rides.length - 1)
    setRides(prev => prev.filter((_, i) => i !== index))
    setParams(p => ({ ...p, tileTarget: nextLen }))
  }, [rides.length])

  const tileCount = layout?.frames.length ?? 0
  const tripName = rides.length === 1 ? rides[0].name : 'trip'

  // The built tile matching the chosen tile index (for stats + export)
  const currentTile = built
    ? built.tiles[built.tileIndices.indexOf(Math.min(tileIndex, Math.max(tileCount - 1, 0)))] ?? built.tiles[0]
    : null

  // mm placement of each built tile within the geographic layout,
  // normalized to the built subset so a single tile sits at the origin
  const placements = useMemo(() => {
    if (!built || !layout) return null
    const cells = built.tileIndices.map(i => layout.cells[i]).filter(Boolean)
    if (cells.length !== built.tiles.length) return null
    const minCx = Math.min(...cells.map(c => c.cx))
    const minCy = Math.min(...cells.map(c => c.cy))
    const mmPerMerc = params.tileWidthMM / layout.spanX
    return built.tiles.map((tile, i) => ({
      bodies: tile.bodies,
      x: (cells[i].cx - minCx) * mmPerMerc,
      y: (cells[i].cy - minCy) * mmPerMerc,
    }))
  }, [built, layout, params.tileWidthMM])

  /** One binary STL per color body, so any slicer can assign filaments */
  const stlFilesForTile = useCallback((tile, folder) => {
    const files = {}
    for (const body of tile.bodies) {
      if (body.name === 'marker') continue // preview-only plug; pockets are in the route body
      const path = folder ? `${folder}/${STL_FILENAMES[body.name]}` : STL_FILENAMES[body.name]
      files[path] = writeStlBinary(body, body.name)
    }
    return files
  }, [])

  /**
   * Build the currently-selected tile fresh via a dedicated worker, rather
   * than trusting `currentTile` (React state updated asynchronously ~120ms
   * after any slider/marker change). Exporting from stale state was the
   * cause of exported files missing just-added climb-marker pockets —
   * every export path now always builds from the live params/markers right
   * before writing files, so what downloads always matches what's checked.
   */
  const buildCurrentTileFresh = useCallback(async () => {
    if (!rawList || !layout) return null
    const idx = Math.min(tileIndex, rawList.length - 1)
    if (idx < 0) return null
    const worker = newGenerateWorker()
    try {
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data)
        worker.onerror = (e) => reject(new Error(e.message))
        worker.postMessage({
          seq: 0,
          days: [{ raw: rawList[idx], distanceKm: tripKm }],
          params,
          eleOverride: globalEleRange(rawList),
          markers,
        })
      })
      if (!result.ok) throw new Error(result.error)
      return result.tiles[0]
    } finally {
      worker.terminate()
    }
  }, [rawList, layout, tileIndex, tripKm, params, markers])

  // Primary export: zip of per-color STLs — universal multi-color workflow.
  // Import all files of a tile together, accept "single object with multiple
  // parts", assign one filament per part.
  const exportCurrentStl = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    setStatus('Building latest model for export…')
    try {
      const tile = await buildCurrentTileFresh()
      if (!tile) return
      const name = tileCount > 1 ? `${tripName}-tile-${tileIndex + 1}` : tripName
      const zipped = zipSync(stlFilesForTile(tile, ''), { level: 6 })
      triggerDownload(new Blob([zipped.buffer], { type: 'application/zip' }), `${name}-stl.zip`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatus(null)
      setExporting(false)
    }
  }, [exporting, buildCurrentTileFresh, tileCount, tileIndex, tripName, stlFilesForTile])

  // Secondary: single-file 3MF (colors import automatically in PrusaSlicer)
  const exportCurrent3mf = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    setStatus('Building latest model for export…')
    try {
      const tile = await buildCurrentTileFresh()
      if (!tile) return
      const name = tileCount > 1 ? `${tripName}-tile-${tileIndex + 1}` : tripName
      triggerDownload(writeThreeMF(tile.bodies, params.colors, name), `${name}.3mf`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatus(null)
      setExporting(false)
    }
  }, [exporting, buildCurrentTileFresh, params.colors, tileCount, tileIndex, tripName])

  // Bambu Studio project: parts arrive pre-assigned to AMS slots 1-6
  const exportCurrentBambu = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    setStatus('Building latest model for export…')
    try {
      const tile = await buildCurrentTileFresh()
      if (!tile) return
      const name = tileCount > 1 ? `${tripName}-tile-${tileIndex + 1}` : tripName
      triggerDownload(writeBambu3MF(tile.bodies, name), `${name}-bambu.3mf`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStatus(null)
      setExporting(false)
    }
  }, [exporting, buildCurrentTileFresh, tileCount, tileIndex, tripName])

  // Export every tile via a dedicated worker (doesn't disturb the preview
  // worker's queue), bundling per-tile STL folders into one zip.
  const exportAll = useCallback(async () => {
    if (!rawList || rawList.length < 2 || exporting) return
    setExporting(true)
    const worker = newGenerateWorker()
    try {
      setStatus(`Building ${rawList.length} tiles for export…`)
      const result = await new Promise((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data)
        worker.onerror = (e) => reject(new Error(e.message))
        worker.postMessage({
          seq: 0,
          days: rawList.map(raw => ({ raw, distanceKm: tripKm })),
          params,
          eleOverride: globalEleRange(rawList),
          markers,
        })
      })
      if (!result.ok) throw new Error(result.error)
      let files = {}
      for (let i = 0; i < result.tiles.length; i++) {
        const folder = `tile-${String(i + 1).padStart(2, '0')}`
        files = { ...files, ...stlFilesForTile(result.tiles[i], folder) }
        const bambu = writeBambu3MF(result.tiles[i].bodies, folder)
        files[`${folder}-bambu.3mf`] = new Uint8Array(await bambu.arrayBuffer())
      }
      setStatus('Compressing zip…')
      await new Promise(r => setTimeout(r, 30)) // let the status paint
      const zipped = zipSync(files, { level: 6 })
      triggerDownload(new Blob([zipped.buffer], { type: 'application/zip' }), `${tripName}-tiles-stl.zip`)
      setStatus(null)
    } catch (e) {
      setStatus(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      worker.terminate()
      setExporting(false)
    }
  }, [rawList, params, exporting, tripKm, tripName, stlFilesForTile, markers])

  return (
    <div className="toy-layout">
      <div className="toy-sidebar">
        <div className="card">
          <h2>Load a ride</h2>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const files = Array.from(e.dataTransfer.files)
              if (files.length) loadFiles(files)
            }}
            className={`toy-dropzone${dragOver ? ' drag-over' : ''}`}
          >
            <i className="ti ti-map-pin" aria-hidden="true" style={{ fontSize: 22, color: 'var(--color-text-faint)' }} />
            <p>Drop .fit / .gpx files here (one per day), or</p>
            <label className="btn btn-sm">
              <i className="ti ti-upload" aria-hidden="true" /> Browse…
              <input
                type="file"
                accept=".fit,.FIT,.gpx,.GPX"
                multiple
                style={{ display: 'none' }}
                onChange={e => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length) loadFiles(files)
                  e.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              className="toy-demo-link"
              onClick={() => {
                setRawList(null)
                setLayout(null)
                const nextLen = rides.length + 1
                setRides(prev => {
                  const track = demoTrack()
                  return [...prev, { name: 'demo-annecy', track, distanceKm: trackDistanceKm(track) }]
                })
                setParams(p => ({ ...p, tileTarget: nextLen }))
              }}
            >
              or try a demo route (Lake Annecy)
            </button>
          </div>
        </div>

        {rides.length > 0 && (
          <div className="card">
            <h2>{rides.length > 1 ? `Rides (${rides.length})` : 'Ride'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rides.map((ride, i) => (
                <div key={`${ride.name}-${i}`} className="toy-ride-row">
                  <span className="toy-ride-num">{i + 1}.</span>
                  <span className="toy-ride-name">{ride.name}</span>
                  <span className="toy-ride-km">{ride.distanceKm.toFixed(0)} km</span>
                  <button type="button" onClick={() => removeRide(i)} className="toy-ride-remove" title="Remove" aria-label={`Remove ${ride.name}`}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tileCount > 1 && (
          <div className="card">
            <h2>Map tiles ({tileCount})</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {[['trip', 'Whole map'], ['single', 'One tile']].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={`btn btn-sm${viewMode === mode ? ' btn-primary' : ''}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setViewMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <button type="button" className="btn btn-sm" disabled={tileIndex === 0} onClick={() => setTileIndex(t => Math.max(0, t - 1))}>
                <i className="ti ti-chevron-left" aria-hidden="true" />
              </button>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Tile {tileIndex + 1} / {tileCount}</span>
              <button type="button" className="btn btn-sm" disabled={tileIndex >= tileCount - 1} onClick={() => setTileIndex(t => Math.min(tileCount - 1, t + 1))}>
                <i className="ti ti-chevron-right" aria-hidden="true" />
              </button>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Tiles are cut from one map grid — terrain and route continue exactly across shared edges. Tile numbering follows the journey.
            </p>
          </div>
        )}

        {climbs.length > 0 && (
          <div className="card">
            <h2>Climb markers</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {climbs.map((climb, i) => (
                <label key={i} className="toy-climb-row">
                  <input
                    type="checkbox"
                    checked={selectedClimbs.includes(i)}
                    onChange={e => setSelectedClimbs(prev => (e.target.checked ? [...prev, i] : prev.filter(k => k !== i)))}
                  />
                  <span style={{ flex: 1 }}>↑ {climb.gainM.toFixed(0)} m · {climb.lengthKm.toFixed(1)} km · {climb.gradePct.toFixed(1)}%</span>
                  <span style={{ color: 'var(--color-text-faint)' }}>km {climb.atKm.toFixed(0)}</span>
                </label>
              ))}
            </div>
            {markers.length > 0 && (
              <>
                <div className="field" style={{ marginTop: 12 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Marker diameter</span>
                    <span style={{ color: 'var(--color-text)' }}>{params.markerDiameterMM} mm</span>
                  </label>
                  <input
                    type="range"
                    min={3}
                    max={8}
                    step={0.5}
                    value={params.markerDiameterMM}
                    onChange={e => setParams(p => ({ ...p, markerDiameterMM: Number(e.target.value) }))}
                    style={{ width: '100%' }}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    const stl = writeStlBinary(markerPlug(params), 'marker plug')
                    triggerDownload(new Blob([stl.buffer], { type: 'model/stl' }), 'marker-plug.stl')
                  }}
                >
                  Download marker plug (.stl) — print {markers.length}× in red
                </button>
                <p className="hint">
                  Each marked summit becomes a small round pad on the route with a real recess modeled into the print — no slicer setup needed. Glue the red plugs in after printing.
                </p>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="adaptive-banner warning">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {rides.length > 0 && (
          <ControlPanel
            params={params}
            onChange={setParams}
            stats={currentTile?.stats ?? null}
            waterOk={rawList ? rawList.every(r => r.waterOk) : null}
            onRetryWater={() => setWaterRetry(n => n + 1)}
          />
        )}

        {built && (
          <div className="card">
            <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={exportCurrentStl} disabled={exporting || building}>
              {exporting ? 'Building…' : tileCount > 1 ? `Export tile ${tileIndex + 1} — color STLs (.zip)` : 'Export color STLs (.zip)'}
            </button>
            {tileCount > 1 && (
              <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={exportAll} disabled={exporting || building}>
                {exporting ? 'Exporting…' : `Export all ${tileCount} tiles — STLs (.zip)`}
              </button>
            )}
            <button type="button" className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 8, color: 'var(--color-green)' }} onClick={exportCurrentBambu} disabled={exporting || building}>
              {exporting ? 'Building…' : 'Bambu Studio project (.3mf, AMS slots pre-assigned)'}
            </button>
            <button type="button" className="toy-demo-link" style={{ width: '100%', marginTop: 8 }} onClick={exportCurrent3mf} disabled={exporting || building}>
              …or generic single-file .3mf {tileCount > 1 ? `for tile ${tileIndex + 1}` : ''}
            </button>
            <p className="hint">
              In your slicer, import a tile's STLs together and accept "load as single object with multiple parts" — positions line up automatically. Then assign one filament per part (base, water, land, rock, snow, route). Every export always rebuilds from your current settings first, so it can never miss a just-checked climb marker.
            </p>
          </div>
        )}
      </div>

      <div className="toy-viewer-pane">
        {placements && currentTile ? (
          <Viewer
            tiles={placements}
            colors={params.colors}
            widthMM={currentTile.stats.widthMM}
            depthMM={currentTile.stats.depthMM}
            heightMM={Math.max(...(built?.tiles.map(t => t.stats.heightMM) ?? [10]))}
          />
        ) : (
          <div className="toy-viewer-empty">{status ?? 'Load a FIT or GPX file to generate your terrain tile'}</div>
        )}
        {(status || building) && (
          <div className="toy-status-pill">
            <span className="toy-spinner" aria-hidden="true" />
            {status ?? 'Updating model…'}
          </div>
        )}
      </div>
    </div>
  )
}
