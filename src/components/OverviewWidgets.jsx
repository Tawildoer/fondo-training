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

// ── Fitness momentum (CTL sparkline + trend + form) ──────────
export function FitnessMomentum({ series = [], current }) {
  if (!series.length || !current) {
    return (
      <div className="card wgt-2">
        <h2>Fitness</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Complete a few sessions or sync some rides and your fitness trend builds here.
        </p>
      </div>
    )
  }
  const recent = series.slice(-42)
  const ctls = recent.map(s => s.ctl)
  const min = Math.min(...ctls), max = Math.max(...ctls)
  const W = 240, H = 56
  const xAt = i => (recent.length <= 1 ? W : (i / (recent.length - 1)) * W)
  const yAt = v => (max === min ? H / 2 : H - ((v - min) / (max - min)) * H)
  const line = recent.map((s, i) => `${i ? 'L' : 'M'} ${xAt(i).toFixed(1)} ${yAt(s.ctl).toFixed(1)}`).join(' ')
  const area = `${line} L ${W} ${H} L 0 ${H} Z`
  const monthAgo = recent[Math.max(0, recent.length - 29)]?.ctl ?? recent[0].ctl
  const delta = Math.round(current.ctl - monthAgo)
  const form = formMeta(current.tsb)

  return (
    <div className="card wgt-2">
      <h2>Fitness</h2>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-accent-text)' }}>{current.ctl}</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CTL</span>
        <span style={pill(delta >= 0 ? 'var(--color-green-light)' : 'var(--color-red-light)', delta >= 0 ? 'var(--color-green-text)' : 'var(--color-red-text)')}>
          {delta >= 0 ? '↑ +' : '↓ '}{delta} / mo
        </span>
        {form && <span style={{ ...pill(form.bg, form.color), marginLeft: 'auto' }}>{form.label}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="momFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#momFill)" stroke="none" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 6 }}>Last 6 weeks · fitness (CTL) trend</div>
    </div>
  )
}

// ── Event readiness (road to event) ──────────────────────────
export function EventReadiness({ event, daysLeft, currentCtl = 0, projection = [] }) {
  if (!event) {
    return (
      <div className="card wgt-2">
        <h2>Your goal</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          No event set — you're training for open-ended fitness. Add an event in Calendar to get a countdown and race-day readiness here.
        </p>
      </div>
    )
  }
  const left = Math.max(0, daysLeft ?? 0)
  const weeks = Math.ceil(left / 7)
  let projCtl = currentCtl
  if (projection.length && event._date) {
    const key = localDateStr(event._date)
    const hit = projection.find(p => localDateStr(p.date) === key) || projection.filter(p => p.date <= event._date).pop()
    if (hit) projCtl = hit.ctl
  }
  const phase = left <= 0 ? 'Race day — go!'
    : left <= 7 ? 'Race week — taper & rest'
    : left <= 14 ? 'Sharpening — hold quality, trim volume'
    : 'Building — bank the work'
  const num = { fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }
  const cap = { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginTop: 3 }

  return (
    <div className="card wgt-2">
      <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Road to {event.name || 'your event'}</h2>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, margin: '6px 0 10px', flexWrap: 'wrap' }}>
        <div><div style={num}>{left}</div><div style={cap}>days left</div></div>
        <div><div style={num}>{weeks}</div><div style={cap}>weeks to go</div></div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            <span style={{ color: 'var(--color-accent-text)' }}>{currentCtl}</span> → <span style={{ color: 'var(--color-accent-text)' }}>{projCtl}</span>
          </div>
          <div style={cap}>fitness at race</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{phase}{event.distance_km ? ` · ${event.distance_km}km` : ''}</div>
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
