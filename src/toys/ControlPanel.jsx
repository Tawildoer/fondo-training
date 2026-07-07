const COLOR_LABELS = {
  base: 'Base',
  water: 'Water',
  grass: 'Land',
  rock: 'Rock',
  snow: 'Snow',
  route: 'Route',
  marker: 'Marker',
}

function Slider({ label, value, min, max, step, unit, display, onChange }) {
  return (
    <div className="field">
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: 'var(--color-text)' }}>{display ?? `${value}${unit ?? ''}`}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="field" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
      <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

function Group({ title, children }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {children}
    </div>
  )
}

export default function ControlPanel({ params, onChange, stats, waterOk, onRetryWater }) {
  const set = (key, value) => onChange({ ...params, [key]: value })

  return (
    <div>
      <Group title="Tile">
        <div className="field">
          <label>Shape</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['square', 'hexagon'].map(shape => (
              <button
                key={shape}
                type="button"
                className={`btn btn-sm${params.shape === shape ? ' btn-primary' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => set('shape', shape)}
              >
                {shape === 'hexagon' ? '⬡ Hexagon' : '□ Square'}
              </button>
            ))}
          </div>
        </div>
        <Slider label="Tile width" value={params.tileWidthMM} min={60} max={300} step={5} unit=" mm" onChange={v => set('tileWidthMM', v)} />
        <Slider label="Base thickness" value={params.baseThicknessMM} min={1} max={10} step={0.5} unit=" mm" onChange={v => set('baseThicknessMM', v)} />
        <Slider label="Terrain padding" value={params.paddingPct} min={0} max={100} step={5} unit="%" onChange={v => set('paddingPct', v)} />
        <Slider
          label="Map tiles"
          value={params.tileTarget}
          min={1}
          max={12}
          step={1}
          display={`${params.tileTarget} tile${params.tileTarget === 1 ? '' : 's'}`}
          onChange={v => set('tileTarget', v)}
        />
        <Slider label="Detail (grid)" value={params.gridRes} min={100} max={500} step={20} unit=" cells" onChange={v => set('gridRes', v)} />
      </Group>

      <Group title="Terrain">
        <Slider label="Vertical exaggeration" value={params.verticalExaggeration} min={0.5} max={5} step={0.1} unit="×" onChange={v => set('verticalExaggeration', v)} />
        <Slider label="Rock line" value={params.rockLinePct} min={5} max={95} step={1} unit="%" onChange={v => set('rockLinePct', v)} />
        <Slider label="Snow line" value={params.snowLinePct} min={10} max={100} step={1} unit="%" onChange={v => set('snowLinePct', v)} />
        <Toggle label="Flatten lakes" value={params.flattenWater} onChange={v => set('flattenWater', v)} />
        {waterOk === false && (
          <div className="adaptive-banner push" style={{ marginTop: 8, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <span>Water data couldn't be fetched for some tiles (OpenStreetMap rate limit or timeout) — lakes and rivers are missing.</span>
            <button type="button" className="btn btn-sm" onClick={onRetryWater}>
              <i className="ti ti-refresh" aria-hidden="true" /> Retry water fetch
            </button>
          </div>
        )}
      </Group>

      <Group title="Route">
        <Slider label="Route width" value={params.routeWidthMM} min={0.6} max={5} step={0.2} unit=" mm" onChange={v => set('routeWidthMM', v)} />
        <Slider label="Ridge height (0 = flush)" value={params.ridgeHeightMM} min={0} max={3} step={0.1} unit=" mm" onChange={v => set('ridgeHeightMM', v)} />
        {params.ridgeHeightMM > 0 && (
          <Slider
            label="Route smoothing"
            value={params.routeSmoothMM}
            min={0}
            max={20}
            step={1}
            display={params.routeSmoothMM === 0 ? 'Off (exact drape)' : `${params.routeSmoothMM} mm`}
            onChange={v => set('routeSmoothMM', v)}
          />
        )}
      </Group>

      <Group title="Colors (preview + slicer hint)">
        <div className="toy-colors-grid">
          {Object.keys(COLOR_LABELS).map(name => (
            <label key={name} className="toy-color-swatch">
              <input
                type="color"
                value={params.colors[name]}
                onChange={e => set('colors', { ...params.colors, [name]: e.target.value })}
              />
              {COLOR_LABELS[name]}
            </label>
          ))}
        </div>
      </Group>

      {stats && (
        <div className="hint" style={{ marginTop: -4 }}>
          <p>Print size: {stats.widthMM.toFixed(0)} × {stats.depthMM.toFixed(0)} × {stats.heightMM.toFixed(1)} mm</p>
          <p>Route: {stats.distanceKm.toFixed(1)} km · elevation range {stats.eleRangeM.toFixed(0)} m</p>
          <p>{stats.triangles.toLocaleString()} triangles</p>
        </div>
      )}
    </div>
  )
}
