// Rider profile radar — a spider chart of power-duration strengths and
// weaknesses, scored against a balanced all-rounder (the dashed midline ring).
// Spokes reaching past the midline are strengths; short spokes are limiters.

import { buildRiderProfile } from '../lib/riderProfile'

const CX = 150, CY = 150, R = 96
const RINGS = [25, 50, 75, 100]

// Vertex on an axis: i of n, at score level (0–100).
function pt(i, n, level) {
  const ang = (-90 + (i * 360) / n) * (Math.PI / 180)
  const r = (level / 100) * R
  return [CX + r * Math.cos(ang), CY + r * Math.sin(ang)]
}
const poly = (n, level) => Array.from({ length: n }, (_, i) => pt(i, n, level).map(v => v.toFixed(1)).join(',')).join(' ')

export default function RiderRadar({ activities = [], ftp, ctl }) {
  const profile = buildRiderProfile(activities, ftp, { ctl })

  if (!profile) {
    return (
      <div className="card wgt-3">
        <h2>Rider profile</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          {ftp
            ? 'Sync a couple of rides with power and your strengths and weaknesses will map out here.'
            : 'Set your FTP and sync some power rides to build your strengths-and-weaknesses profile.'}
        </p>
      </div>
    )
  }

  const axes = profile.axes
  const n = axes.length
  const shape = axes.map((a, i) => pt(i, n, a.hasData ? a.score : 0).map(v => v.toFixed(1)).join(',')).join(' ')

  return (
    <div className="card wgt-3">
      <h2>Rider profile</h2>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
        Your power-duration shape vs a balanced all-rounder · {profile.rides} rides
      </div>

      <svg viewBox="0 0 300 300" width="100%" style={{ display: 'block', overflow: 'visible', maxWidth: 360, margin: '0 auto' }}>
        <defs>
          <linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-violet)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.40" />
          </linearGradient>
        </defs>

        {/* grid rings */}
        {RINGS.map(lvl => (
          <polygon key={lvl} points={poly(n, lvl)} fill="none"
            stroke="var(--color-border)" strokeWidth="1" opacity={lvl === 100 ? 0.9 : 0.5} />
        ))}
        {/* spokes */}
        {axes.map((_, i) => {
          const [x, y] = pt(i, n, 100)
          return <line key={i} x1={CX} y1={CY} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="var(--color-border)" strokeWidth="1" opacity="0.5" />
        })}
        {/* balanced reference (midline) */}
        <polygon points={poly(n, 50)} fill="none" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.7" />

        {/* rider shape */}
        <polygon points={shape} fill="url(#radarFill)" stroke="var(--color-violet)" strokeWidth="2" strokeLinejoin="round" />
        {axes.map((a, i) => {
          const [x, y] = pt(i, n, a.hasData ? a.score : 0)
          return (
            <circle key={a.key} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.6" fill="var(--color-violet)">
              <title>{`${a.label}: ${a.value}${a.unit === 'W' ? ' W' : ' ' + a.unit} · score ${a.score}`}</title>
            </circle>
          )
        })}

        {/* axis labels */}
        {axes.map((a, i) => {
          const [lx, ly] = pt(i, n, 100)
          const dx = lx - CX, dy = ly - CY
          const anchor = Math.abs(dx) < 14 ? 'middle' : dx > 0 ? 'start' : 'end'
          const ox = CX + dx * 1.16, oy = CY + dy * 1.16
          return (
            <text key={a.key} x={ox.toFixed(1)} y={(oy + 3).toFixed(1)} textAnchor={anchor}
              fontSize="10.5" fontWeight="600" fill="var(--color-text)">
              {a.label}{a.estimate ? '*' : ''}
            </text>
          )
        })}
      </svg>

      {(profile.strength || profile.limiter) && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
          {profile.strength && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              Strength <strong style={{ color: 'var(--color-accent-text)' }}>{profile.strength.label}</strong>
            </span>
          )}
          {profile.limiter && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              Limiter <strong style={{ color: 'var(--color-electric)' }}>{profile.limiter.label}</strong>
            </span>
          )}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
        Scored from your hardest efforts at each duration — untested abilities read low, so go
        chase one to fill it in. *Sprint is approximate (Strava streams are downsampled).
      </p>
    </div>
  )
}
