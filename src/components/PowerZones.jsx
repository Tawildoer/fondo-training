import { ZONE_DEFINITIONS } from '../lib/planGenerator'

// HR zones run on their own %-of-max curve (not the power %FTP curve), shown
// alongside power so each zone reads as one thing.
const HR_ZONE_FACTORS = [
  [0.50, 0.60],
  [0.60, 0.72],
  [0.72, 0.82],
  [0.82, 0.89],
  [0.89, 1.00],
]

// One-line purpose per zone — the inline explainer that replaces the old tables.
const ZONE_PURPOSE = {
  Z1: 'Very easy spinning — active recovery between hard days.',
  Z2: 'All-day aerobic pace. The bulk of your riding lives here.',
  Z3: 'Comfortably hard, sustainable for long efforts.',
  Z4: 'Right around FTP — the work that lifts your ceiling.',
  Z5: 'Short, very hard intervals for top-end power.',
}

const r = n => Math.round(n)

// Compact FTP progression sparkline. Lives in a constrained column so it can't
// balloon to full page width.
function FtpChart({ history }) {
  const W = 300, H = 84, padL = 6, padR = 6, padT = 12, padB = 18
  const values = history.map(h => h.ftp)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = (max - min) || 1
  const n = history.length
  const xAt = i => (n === 1 ? W / 2 : padL + (i / (n - 1)) * (W - padL - padR))
  const yAt = v => padT + (1 - (v - min) / range) * (H - padT - padB)
  const points = history.map((h, i) => ({ x: xAt(i), y: yAt(h.ftp), ftp: h.ftp, date: new Date(h.recorded_at) }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaPath = n > 1 ? `${linePath} L ${xAt(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${xAt(0).toFixed(1)} ${(H - padB).toFixed(1)} Z` : ''
  const fmt = d => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  return (
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
          <circle cx={p.x} cy={p.y} r="3" fill="var(--color-accent)" />
          {(i === 0 || i === n - 1 || n === 1) && (
            <text x={p.x} y={p.y - 7} textAnchor="middle" fontSize="9" fill="var(--color-text-muted)" fontWeight="600">{p.ftp}</text>
          )}
          <text x={Math.min(Math.max(p.x, 14), W - 14)} y={H - 5} textAnchor="middle" fontSize="8" fill="var(--color-text-faint)">{fmt(p.date)}</text>
        </g>
      ))}
    </svg>
  )
}

// The zone "ladder": one graph — each zone is a bar placed on a shared 0→120%
// FTP axis — with watts, HR and a purpose line inline as the explainer.
function ZoneLadder({ ftp, maxHR }) {
  const MAXF = 1.2
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {ZONE_DEFINITIONS.map((z, i) => {
        const [lo, hi] = z.factors
        const left = (lo / MAXF) * 100
        const width = ((hi - lo) / MAXF) * 100
        const watts = ftp ? `${r(lo * ftp)}–${r(hi * ftp)}W` : null
        const [hlo, hhi] = HR_ZONE_FACTORS[i]
        const bpm = maxHR ? `${r(hlo * maxHR)}–${r(hhi * maxHR)} bpm` : null
        return (
          <div key={z.z} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <span className={`sess-${z.z.toLowerCase()}`} style={{ flexShrink: 0, width: 30, textAlign: 'center', padding: '3px 0', borderRadius: 6, fontWeight: 700, fontSize: 11, marginTop: 1 }}>{z.z}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{z.name} <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>· {r(lo * 100)}–{r(hi * 100)}%</span></span>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{watts}{watts && bpm ? ' · ' : ''}{bpm}</span>
              </div>
              {/* position bar on the shared FTP axis */}
              <div style={{ position: 'relative', height: 8, borderRadius: 5, background: 'var(--color-surface2)', margin: '5px 0 4px' }}>
                <div style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 0, bottom: 0, borderRadius: 5, background: `var(--zone-${z.z.toLowerCase()}-bg)` }} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>{ZONE_PURPOSE[z.z]}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PowerZones({ user, ftpHistory = [], activities = [] }) {
  const ftp = user.ftp
  const maxHR = user.max_hr

  const first = ftpHistory[0]
  const last = ftpHistory[ftpHistory.length - 1]
  const delta = first && last ? last.ftp - first.ftp : 0
  const fmt = d => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  return (
    <div>
      {/* FTP: current value + update + a compact progression, two-up on desktop. */}
      <div className="card wgt-2">
        <h2>FTP</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{ftp ? `${ftp}W` : '—'}</span>
              {ftpHistory.length > 1 && (
                <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: delta >= 0 ? 'var(--color-green-light)' : 'var(--color-red-light)', color: delta >= 0 ? 'var(--color-green-text)' : 'var(--color-red-text)' }}>
                  {delta >= 0 ? '+' : ''}{delta}W since {fmt(first.recorded_at)}
                </span>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 7 }}>
              Set your FTP in <strong>Menu → Settings</strong>. The planner schedules a 20-min test every ~4 weeks — update it from the result.
            </p>
          </div>
          <div style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 460 }}>
            {ftpHistory.length > 0 ? (
              <FtpChart history={ftpHistory} />
            ) : (
              <div className="tip-box" style={{ marginBottom: 0 }}>
                <i className="ti ti-chart-line" aria-hidden="true" />
                <span>Your FTP progression charts here as you log updates.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Training zones{ftp ? ` — FTP ${ftp}W` : ''}{maxHR ? ` · max HR ${maxHR} bpm` : ''}</h2>
        {!ftp ? (
          <div className="tip-box">
            <i className="ti ti-info-circle" aria-hidden="true" />
            <span>
              Set your FTP above to see personalised zones. If you don't know it, ride all-out for
              20 minutes and take 95% of your average power.
            </span>
          </div>
        ) : (
          <ZoneLadder ftp={ftp} maxHR={maxHR} />
        )}
      </div>
    </div>
  )
}
