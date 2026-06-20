import { useState } from 'react'
import { ZONE_DEFINITIONS, getZoneWatts } from '../lib/planGenerator'

const HR_ZONE_FACTORS = [
  { z: 'Z1', name: 'Recovery',  factors: [0.50, 0.60] },
  { z: 'Z2', name: 'Endurance', factors: [0.60, 0.72] },
  { z: 'Z3', name: 'Tempo',     factors: [0.72, 0.82] },
  { z: 'Z4', name: 'Threshold', factors: [0.82, 0.89] },
  { z: 'Z5', name: 'VO2 max',   factors: [0.89, 1.00] },
]

function FtpChart({ history }) {
  const W = 320, H = 130, padL = 6, padR = 6, padT = 14, padB = 22
  const values = history.map(h => h.ftp)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = (max - min) || 1
  const n = history.length

  const xAt = i => n === 1 ? W / 2 : padL + (i / (n - 1)) * (W - padL - padR)
  const yAt = v => padT + (1 - (v - min) / range) * (H - padT - padB)

  const points = history.map((h, i) => ({ x: xAt(i), y: yAt(h.ftp), ftp: h.ftp, date: new Date(h.recorded_at) }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaPath = n > 1 ? `${linePath} L ${xAt(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${xAt(0).toFixed(1)} ${(H - padB).toFixed(1)} Z` : ''

  const first = history[0]
  const last = history[history.length - 1]
  const delta = last.ftp - first.ftp
  const fmt = d => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{last.ftp}W</span>
        {n > 1 && (
          <span style={{
            fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
            background: delta >= 0 ? 'var(--color-green-light)' : 'var(--color-red-light)',
            color: delta >= 0 ? 'var(--color-green-text)' : 'var(--color-red-text)',
          }}>
            {delta >= 0 ? '+' : ''}{delta}W since {fmt(first.recorded_at)}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="ftpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {n > 1 && <path d={areaPath} fill="url(#ftpFill)" stroke="none" />}
        {n > 1 && <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="var(--color-accent)" />
            {(i === 0 || i === n - 1 || n === 1) && (
              <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)" fontWeight="600">{p.ftp}</text>
            )}
            <text x={Math.min(Math.max(p.x, 14), W - 14)} y={H - 6} textAnchor="middle" fontSize="8" fill="var(--color-text-faint)">
              {fmt(p.date)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function ZoneTable({ columns, rows }) {
  return (
    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          {columns.map(col => (
            <th key={col.key} style={{
              textAlign: col.align || 'left', paddingBottom: 10, fontWeight: 600,
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: 'var(--color-text-muted)',
            }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderTop: '0.5px solid var(--color-border)' }}>
            {columns.map(col => (
              <td key={col.key} style={{
                padding: '8px 0', textAlign: col.align || 'left',
                paddingRight: col.align === 'right' ? 0 : 12,
              }}>
                {row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function PowerZones({ user, onUpdateFTP, ftpHistory = [] }) {
  const [ftpInput, setFtpInput] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleFTPSubmit(e) {
    e.preventDefault()
    const parsed = parseInt(ftpInput)
    if (!parsed || parsed < 50 || parsed > 600) return
    setSaving(true)
    await onUpdateFTP(parsed)
    setFtpInput('')
    setSaving(false)
  }

  const ftp = user.ftp
  const maxHR = user.max_hr

  const powerRows = ZONE_DEFINITIONS.map(zone => {
    const w = getZoneWatts(zone.z, ftp)
    return {
      zone: (
        <span className={`sess-${zone.z.toLowerCase()}`} style={{ padding: '2px 10px', borderRadius: 20, fontWeight: 600, fontSize: 12 }}>
          {zone.z}
        </span>
      ),
      name: <span style={{ fontWeight: 500 }}>{zone.name}</span>,
      range: <span style={{ fontWeight: 600 }}>{w ? `${w.lo}–${w.hi}W` : '—'}</span>,
      pct: <span style={{ color: 'var(--color-text-muted)' }}>{Math.round(zone.factors[0] * 100)}–{Math.round(zone.factors[1] * 100)}%</span>,
    }
  })

  const hrRows = HR_ZONE_FACTORS.map(zone => {
    const lo = Math.round(zone.factors[0] * maxHR)
    const hi = Math.round(zone.factors[1] * maxHR)
    return {
      zone: (
        <span className={`sess-${zone.z.toLowerCase()}`} style={{ padding: '2px 10px', borderRadius: 20, fontWeight: 600, fontSize: 12 }}>
          {zone.z}
        </span>
      ),
      name: <span style={{ fontWeight: 500 }}>{zone.name}</span>,
      range: <span style={{ fontWeight: 600 }}>{lo}–{hi} bpm</span>,
      pct: <span style={{ color: 'var(--color-text-muted)' }}>{Math.round(zone.factors[0] * 100)}–{Math.round(zone.factors[1] * 100)}%</span>,
    }
  })

  const tableCols = [
    { key: 'zone', label: 'Zone' },
    { key: 'name', label: 'Name' },
    { key: 'range', label: 'Range', align: 'right' },
    { key: 'pct', label: '% Max', align: 'right' },
  ]

  return (
    <div>
      <div className="card">
        <h2>Update FTP</h2>
        <form onSubmit={handleFTPSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="ftp-update">New FTP (watts)</label>
            <input
              id="ftp-update"
              type="number"
              value={ftpInput}
              onChange={e => setFtpInput(e.target.value)}
              placeholder={ftp ? `Current: ${ftp}W` : 'e.g. 250'}
              min="50" max="600"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving || !ftpInput}>
            {saving ? 'Saving…' : 'Update'}
          </button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 8 }}>
          Updating your FTP recalculates all zones and regenerates your plan targets.
        </p>
      </div>

      {ftp && (
        <div className="card">
          <h2>FTP progression</h2>
          {ftpHistory.length > 0 ? (
            <FtpChart history={ftpHistory} />
          ) : (
            <div className="tip-box" style={{ marginBottom: 0 }}>
              <i className="ti ti-chart-line" aria-hidden="true" />
              <span>Your FTP progression will chart here as you log updates. Update your FTP above after each test to track gains over time.</span>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Power zones{ftp ? ` — FTP ${ftp}W` : ''}</h2>
        {!ftp ? (
          <div className="tip-box">
            <i className="ti ti-info-circle" aria-hidden="true" />
            <span>
              Set your FTP above to see personalised power targets. If you don't know your FTP,
              ride all-out for 20 minutes and take 95% of your average power.
            </span>
          </div>
        ) : (
          <ZoneTable columns={tableCols} rows={powerRows} />
        )}
      </div>

      {maxHR && (
        <div className="card">
          <h2>Heart rate zones — max HR {maxHR} bpm</h2>
          <ZoneTable columns={tableCols} rows={hrRows} />
        </div>
      )}

      <div className="card">
        <h2>How to test your FTP</h2>
        <div className="tip-box" style={{ marginBottom: 12 }}>
          <i className="ti ti-calendar" aria-hidden="true" />
          <span>Re-test every 4–6 weeks. Recovery weeks in your plan are the ideal time — your legs are fresh and the result will be accurate.</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            {
              icon: 'ti-clock',
              title: '20-minute test',
              desc: 'Warm up for 20 min including a short hard effort. Then ride absolutely all-out for 20 minutes. Take 95% of your average power as your new FTP.',
            },
            {
              icon: 'ti-stairs-up',
              title: 'Ramp test',
              desc: 'Start easy and increase power by a fixed step each minute until you can\'t hold the power. Your FTP ≈ 75% of your best 1-minute power. Many smart trainers run this automatically.',
            },
          ].map(tip => (
            <div key={tip.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <i className={`ti ${tip.icon}`} style={{ fontSize: 18, color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{tip.title}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>{tip.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
