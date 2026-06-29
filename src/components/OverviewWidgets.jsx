// Landing-page widgets for the Overview — each one driven by data we already
// compute (training-load series, projection, the planned week), so they inform
// rather than decorate. Kept here to keep Overview itself a clean composition.

import { getScheduledSessions, localDateStr } from '../lib/schedule'
import { estActivityTSS, activitySport } from '../lib/trainingLoad'
import { SPORTS } from '../lib/sports'

// Form (TSB) bands — mirrors Analytics' thresholds.
function formMeta(tsb) {
  if (tsb == null) return null
  if (tsb > 8) return { label: 'Fresh', color: 'var(--color-green-text)', bg: 'var(--color-green-light)' }
  if (tsb < -15) return { label: 'Fatigued', color: 'var(--color-red-text)', bg: 'var(--color-red-light)' }
  return { label: 'Balanced', color: 'var(--color-accent-text)', bg: 'var(--color-accent-light)' }
}

const pill = (bg, color) => ({ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: bg, color })

// ── Greeting + status headline ───────────────────────────────
export function GreetingHero({ name, tsb }) {
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const form = formMeta(tsb)
  const line = !form ? "Let's see where today takes you."
    : form.label === 'Fresh' ? "You're fresh — a good day to go hard."
    : form.label === 'Fatigued' ? "You're carrying fatigue — keep it easy or rest."
    : "Form's balanced — train to plan."
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
        {greet}{name ? `, ${name}` : ''}
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {form && <span style={pill(form.bg, form.color)}>{form.label}</span>}
        <span>{line}</span>
      </div>
    </div>
  )
}

// ── Mon–Sun week strip ───────────────────────────────────────
const DOW_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
export function WeekStrip({ plan, sessionState, planStart }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const mon = new Date(today); mon.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow))
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d })

  const byKey = {}
  getScheduledSessions(plan, { includeRest: true, base: planStart }).forEach(s => { byKey[localDateStr(s.date)] = s })

  const cells = days.map(d => byKey[localDateStr(d)] || null)
  const planned = cells.filter(s => s && s.session.zone !== 'rest').length
  const done = cells.filter(s => s && s.session.zone !== 'rest' && sessionState[`w${s.weekNum}_${s.idx}`]?.completed).length

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>This week</h2>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{planned ? `${done}/${planned} done` : 'Not planned yet'}</span>
      </div>
      <div className="wk-strip">
        {days.map((d, i) => {
          const s = cells[i]
          const isToday = d.getTime() === today.getTime()
          const isRest = !s || s.session.zone === 'rest'
          const st = s && !isRest ? (sessionState[`w${s.weekNum}_${s.idx}`] || {}) : {}
          const z = isRest ? null : s.session.zone
          return (
            <div key={i} className={`wk-day${isToday ? ' today' : ''}`}>
              <div className="wk-dow">{DOW_LABELS[i]}</div>
              <div
                className={`wk-block${isRest ? ' rest' : ` sess-${z}`}`}
                style={{ opacity: st.bailed ? 0.4 : 1 }}
                title={s ? `${s.session.name}` : 'Rest'}
              >
                {isRest ? '' : st.completed ? <i className="ti ti-check" aria-hidden="true" /> : z.toUpperCase()}
              </div>
              <div className="wk-num">{d.getDate()}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Consistency heatmap (last 10 weeks, shaded by load) ──────
export function ConsistencyHeatmap({ series = [] }) {
  if (!series.length) {
    return (
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2>Consistency</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Your training history fills in here as you complete sessions and sync workouts.
        </p>
      </div>
    )
  }
  const WEEKS = 13
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const thisMon = new Date(today); thisMon.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow))
  const start = new Date(thisMon); start.setDate(thisMon.getDate() - (WEEKS - 1) * 7)

  const loadByKey = {}
  series.forEach(s => { loadByKey[localDateStr(s.date)] = s.load })
  const maxLoad = Math.max(60, ...series.map(s => s.load))

  // Day-major (rows = Mon→Sun, columns = weeks) so the grid fills the card width.
  const cells = []
  for (let d = 0; d < 7; d++) {
    for (let w = 0; w < WEEKS; w++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d)
      cells.push({ day, load: loadByKey[localDateStr(day)] || 0, future: day > today })
    }
  }
  const shade = load => {
    if (load <= 0) return 'var(--color-surface2)'
    const t = Math.min(1, load / maxLoad)
    return `color-mix(in srgb, var(--color-accent) ${Math.round(18 + t * 82)}%, var(--color-surface2))`
  }
  const swatch = bg => ({ width: 11, height: 11, borderRadius: 3, background: bg, display: 'inline-block' })

  return (
    <div className="card wgt-2">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Consistency</h2>
        <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>{WEEKS}w · by load</span>
      </div>
      <div className="heatmap" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
        {cells.map((c, i) => (
          <div
            key={i}
            className="heat-cell"
            title={`${c.day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}${c.load ? ` · ${c.load} TSS` : ''}`}
            style={{ background: c.future ? 'transparent' : shade(c.load), border: c.future ? '1px dashed var(--color-border)' : 'none' }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 10, color: 'var(--color-text-faint)' }}>
        <span>Less</span>
        <span style={swatch('var(--color-surface2)')} />
        <span style={swatch('color-mix(in srgb, var(--color-accent) 45%, var(--color-surface2))')} />
        <span style={swatch('color-mix(in srgb, var(--color-accent) 75%, var(--color-surface2))')} />
        <span style={swatch('var(--color-accent)')} />
        <span>More</span>
      </div>
    </div>
  )
}

// ── Recent rides (last 3 synced activities) ──────────────────
function fmtDur(s) {
  const m = Math.round((s || 0) / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}
export function RecentRides({ activities = [], ftp, maxHr, thresholdPaceRun, cssSwim }) {
  const rides = [...activities]
    .filter(a => a.start_date)
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
    .slice(0, 3)

  return (
    <div className="card wgt-2">
      <h2>Recent activity</h2>
      {rides.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Connect Strava (Menu → Connections) and your latest workouts show up here.
        </p>
      ) : (
        <div>
          {rides.map((a, i) => {
            const d = new Date(a.start_date.slice(0, 10) + 'T00:00:00') // local date (avoid the start_date "Z" shift)
            const tss = estActivityTSS(a, ftp, maxHr, { thresholdPaceRun, cssSwim })
            const aSport = activitySport(a)
            const km = a.distance_m ? (a.distance_m / 1000).toFixed(a.distance_m >= 100000 ? 0 : 1) : null
            const np = a.weighted_avg_watts || a.avg_watts
            return (
              <div key={a.id || i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 0', borderTop: i ? '0.5px solid var(--color-border)' : 'none' }}>
                <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--color-accent-text)' }}>
                  <i className={`ti ${SPORTS[aSport]?.icon || 'ti-bike'}`} style={{ fontSize: 17 }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name || 'Workout'}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} · {fmtDur(a.moving_time_s)}{km ? ` · ${km} km` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>{tss > 0 ? tss : (np ? Math.round(np) : '—')}</div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tss > 0 ? 'TSS' : (np ? 'W avg' : '')}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
