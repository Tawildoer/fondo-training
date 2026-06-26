// Landing-page widgets for the Overview — each one driven by data we already
// compute (training-load series, projection, the planned week), so they inform
// rather than decorate. Kept here to keep Overview itself a clean composition.

import { getScheduledSessions, localDateStr } from '../lib/schedule'

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
          Your training history fills in here as you complete sessions and sync rides.
        </p>
      </div>
    )
  }
  const WEEKS = 10
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const thisMon = new Date(today); thisMon.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow))
  const start = new Date(thisMon); start.setDate(thisMon.getDate() - (WEEKS - 1) * 7)

  const loadByKey = {}
  series.forEach(s => { loadByKey[localDateStr(s.date)] = s.load })
  const maxLoad = Math.max(60, ...series.map(s => s.load))

  const cells = []
  for (let w = 0; w < WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d)
      cells.push({ day, load: loadByKey[localDateStr(day)] || 0, future: day > today })
    }
  }
  const shade = load => {
    if (load <= 0) return 'var(--color-surface2)'
    const t = Math.min(1, load / maxLoad)
    return `color-mix(in srgb, var(--color-accent) ${Math.round(18 + t * 82)}%, var(--color-surface2))`
  }
  const rowLabels = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Consistency</h2>
        <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>last {WEEKS} weeks · shaded by load</span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 15px)', gap: 3, fontSize: 9, color: 'var(--color-text-faint)' }}>
          {rowLabels.map((l, i) => <div key={i} style={{ lineHeight: '15px' }}>{l}</div>)}
        </div>
        <div className="heatmap">
          {cells.map((c, i) => (
            <div
              key={i}
              className="heat-cell"
              title={`${c.day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}${c.load ? ` · ${c.load} TSS` : ''}`}
              style={{ background: c.future ? 'transparent' : shade(c.load), border: c.future ? '1px dashed var(--color-border)' : 'none' }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
