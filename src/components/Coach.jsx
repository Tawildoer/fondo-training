// The coach: narrates the deterministic ride/week analysis from lib/coach.js.
// Per-ride feedback lives in the activity detail; the weekly roll-up sits on
// the Overview.

import { analyzeRide, analyzeRolling7, ZONE_LABEL } from '../lib/coach'

const TONE = {
  praise: { bg: 'var(--color-green-light)', color: 'var(--color-green-text)', icon: 'ti-trophy' },
  nudge:  { bg: 'var(--color-amber-light)', color: 'var(--color-amber-text)', icon: 'ti-target-arrow' },
  note:   { bg: 'var(--color-surface2)', color: 'var(--color-text)', icon: 'ti-message-circle' },
}

const ZONES = ['z1', 'z2', 'z3', 'z4', 'z5']

// Stacked horizontal bar of where the ride's time actually went.
function ZoneStrip({ min, totalMin }) {
  if (!totalMin) return null
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', height: 8, borderRadius: 5, overflow: 'hidden', background: 'var(--color-surface2)' }}>
        {ZONES.map(z => {
          const pct = (min[z] / totalMin) * 100
          if (pct < 0.5) return null
          return <div key={z} title={`${ZONE_LABEL[z]} · ${Math.round(min[z])} min`} style={{ width: `${pct}%`, background: `var(--zone-${z}-bg)` }} />
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
        {ZONES.filter(z => min[z] >= 1).map(z => (
          <span key={z} style={{ fontSize: 10, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: `var(--zone-${z}-bg)`, display: 'inline-block' }} />
            {z.toUpperCase()} {Math.round(min[z])}m
          </span>
        ))}
      </div>
    </div>
  )
}

function CoachShell({ tone, title, msg, theme = 'tone', fill = false, children }) {
  const t = TONE[tone] || TONE.note
  // 'site' theme keeps the weekly coach on the electric palette (surface +
  // brand-blue / violet accents) instead of the green/amber pastel.
  const site = theme === 'site'
  const accent = tone === 'nudge' ? 'var(--color-violet)' : 'var(--color-accent)'
  const wrap = site
    ? { background: 'var(--color-surface2)', borderLeft: `3px solid ${tone === 'nudge' ? 'var(--color-electric)' : 'var(--color-accent)'}` }
    : { background: t.bg }
  const headColor = site ? accent : t.color
  return (
    <div style={{ ...wrap, borderRadius: 'var(--radius-sm)', padding: '11px 13px', marginBottom: 4, ...(fill ? { flex: 1, display: 'flex', flexDirection: 'column' } : null) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <i className={`ti ${t.icon}`} style={{ fontSize: 15, color: headColor }} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 700, color: headColor }}>Coach</span>
        <span style={{ fontSize: 12, fontWeight: 700 }}>· {title}</span>
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--color-text)' }}>{msg}</p>
      {/* When filling, pin the bar visual to the bottom so both coach cards line
          up symmetrically (heading/message at top, bars at the bottom). */}
      {children && <div style={fill ? { marginTop: 'auto' } : undefined}>{children}</div>}
    </div>
  )
}

// Coach card for the most recent ride — surfaced on the Overview as a
// forward-looking reminder, not embedded in the workout list.
export function LastRideCoach({ activity, session, ftp }) {
  const a = analyzeRide(activity, session, ftp)
  if (!a) return null
  return (
    <div className="card wgt-2" style={{ display: 'flex', flexDirection: 'column' }}>
      <h2>Coach · last ride</h2>
      <CoachShell tone={a.tone} title={a.title} msg={a.msg} theme="site" fill>
        <ZoneStrip min={a.tiz.min} totalMin={a.tiz.totalMin} />
      </CoachShell>
    </div>
  )
}

// Actual-vs-target mini bars for the week's hard zones. The target marker +
// "/ target" only appear when there's actually a planned target for the zone.
function WeekBars({ bars, assumed = false }) {
  const peak = Math.max(1, ...bars.map(b => Math.max(b.prescribed, b.actual)))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
      {bars.map(b => (
        <div key={b.zone} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11 }}>
          <span style={{ width: 22, fontWeight: 700, color: 'var(--color-text-muted)' }}>{b.zone.toUpperCase()}</span>
          <div style={{ flex: 1, position: 'relative', height: 14, borderRadius: 7, background: 'var(--color-surface)', border: '0.5px solid var(--color-border)', overflow: 'hidden' }}>
            {/* actual fill */}
            <div style={{ width: `${Math.min(100, (b.actual / peak) * 100)}%`, height: '100%', borderRadius: 7, background: `var(--zone-${b.zone}-bg)` }} />
            {/* target marker — only when a target exists */}
            {b.prescribed > 0 && (
              <div style={{ position: 'absolute', left: `${(b.prescribed / peak) * 100}%`, top: 0, bottom: 0, width: 3, marginLeft: -1.5, background: 'var(--color-text)', borderRadius: 2 }} title={`Target ${b.prescribed} min`} />
            )}
          </div>
          <span style={{ width: 92, textAlign: 'right', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--color-text)', fontSize: 12 }}>{b.actual}min</strong>{b.prescribed > 0 ? ` / ${b.prescribed}min` : ''}
          </span>
        </div>
      ))}
      {assumed && (
        <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 1 }}>
          Targets assumed from your fitness + event type
        </div>
      )}
    </div>
  )
}

// Rolling 7-day coach card for the Overview. `planned`: sessions in the trailing
// week; `rides`: activities in the trailing week.
export function WeekCoach({ planned, rides, upcoming, ctl, eventType, ftp }) {
  const a = analyzeRolling7(planned, rides, ftp, upcoming, { ctl, eventType })
  if (!a) return null
  return (
    <div className="card wgt-2" style={{ display: 'flex', flexDirection: 'column' }}>
      <h2>Coach · last 7 days</h2>
      <CoachShell tone={a.tone} title={a.title} msg={a.msg} theme="site" fill>
        {a.bars?.length > 0 && <WeekBars bars={a.bars} assumed={a.assumed} />}
      </CoachShell>
    </div>
  )
}
