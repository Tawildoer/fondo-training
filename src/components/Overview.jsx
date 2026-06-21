import { useState, useMemo } from 'react'
import { getTodaySessions, getScheduledSessions } from '../lib/schedule'
import { RPE_LABELS } from '../lib/planGenerator'
import { computeTrainingLoad, parseLeadingMinutes } from '../lib/trainingLoad'

// Monday 00:00 → Sunday 23:59 of the week containing `now`.
function thisWeekRange(now = new Date()) {
  const dow = now.getDay()
  const mon = new Date(now); mon.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow)); mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999)
  return [mon, sun]
}

const PHASE_COLORS = { base: '#378ADD', build: '#639922', 'race-prep': '#534AB7', taper: '#EF9F27', recovery: '#888780' }
const CHART_H = 150

function CatchUpCard({ unconfirmed, onToggle, onBail, onRPE }) {
  // Sessions just confirmed "Did it" are retained locally so the user can rate
  // them before they drop out of the unconfirmed list.
  const [rating, setRating] = useState({}) // key -> session item awaiting RPE

  function key(i) { return `${i.weekNum}_${i.idx}` }

  function didIt(item) {
    onToggle(item.weekNum, item.idx, item.session.zone)
    setRating(prev => ({ ...prev, [key(item)]: item }))
  }
  function dismiss(item) {
    setRating(prev => { const next = { ...prev }; delete next[key(item)]; return next })
  }
  function pickRPE(item, r) {
    onRPE(item.weekNum, item.idx, r, item.session.zone)
    dismiss(item)
  }

  const ratingKeys = new Set(Object.keys(rating))
  const asking = (unconfirmed || []).filter(i => !ratingKeys.has(key(i)))
  const ratingItems = Object.values(rating)

  if (!asking.length && !ratingItems.length) return null

  return (
    <div className="card" style={{ borderLeft: '3px solid var(--color-accent)' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className="ti ti-clock-question" aria-hidden="true" /> Catch up
      </h2>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -4, marginBottom: 12 }}>
        Log these so your plan can adapt — did you do them?
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {asking.map(item => {
          const { session, date } = item
          return (
            <div key={key(item)} className={`sess-${session.zone}`} style={{ borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>
                  {date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{session.name}</span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.85, marginBottom: 10 }}>{session.desc}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => didIt(item)}>
                  <i className="ti ti-check" aria-hidden="true" /> Did it
                </button>
                <button className="btn btn-sm" onClick={() => onBail(item.weekNum, item.idx, session.zone)} style={{ color: 'var(--color-red-text)' }}>
                  <i className="ti ti-circle-x" aria-hidden="true" /> Missed it
                </button>
              </div>
            </div>
          )
        })}

        {ratingItems.map(item => {
          const { session } = item
          return (
            <div key={key(item)} className={`sess-${session.zone}`} style={{ borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ti ti-circle-check" style={{ opacity: 0.7 }} aria-hidden="true" />
                <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>{session.name}</span> — how did it feel?
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.65 }}>RPE</span>
                {[1, 2, 3, 4, 5].map(r => (
                  <button
                    key={r}
                    onClick={() => pickRPE(item, r)}
                    style={{
                      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                      border: '1.5px solid var(--color-border-strong)', background: 'transparent', color: 'inherit',
                    }}
                  >
                    {r}
                  </button>
                ))}
                <button onClick={() => dismiss(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'inherit' }}>
                  Skip
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 6 }}>
                1 = {RPE_LABELS[1]} · 5 = {RPE_LABELS[5]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StreakCard({ streak }) {
  const current = streak?.current || 0
  const best = streak?.best || 0
  if (!current && !best) return null

  const hot = current > 0
  return (
    <div className="card" style={{
      display: 'flex', alignItems: 'center', gap: 14,
      background: hot
        ? 'linear-gradient(135deg, var(--color-amber-light), var(--color-coral-light))'
        : 'var(--color-surface)',
      border: hot ? '0.5px solid var(--color-amber)' : '0.5px solid var(--color-border)',
    }}>
      <div style={{
        fontSize: 30, lineHeight: 1, flexShrink: 0,
        filter: hot ? 'none' : 'grayscale(1) opacity(0.5)',
      }} aria-hidden="true">🔥</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 700, letterSpacing: '-0.03em', color: hot ? 'var(--color-coral-text)' : 'var(--color-text)' }}>
            {current}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: hot ? 'var(--color-coral-text)' : 'var(--color-text-muted)' }}>
            session{current === 1 ? '' : 's'} in a row
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {current > 0
            ? (current >= best ? "That's your best run yet — keep it alive!" : `Best streak: ${best}`)
            : `Complete your next session to start a new streak · Best: ${best}`}
        </div>
      </div>
    </div>
  )
}

function PlanWeekCTA({ onPlanWeek }) {
  return (
    <div className="card" style={{ background: 'var(--grad-hero)', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <i className="ti ti-calendar-bolt" style={{ fontSize: 26, color: 'var(--color-electric)' }} aria-hidden="true" />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>Plan this week</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>Tell the app your time + how you feel, and it'll draft your week.</div>
        </div>
      </div>
      <button className="btn btn-sm" onClick={onPlanWeek} style={{ background: '#fff', color: 'var(--color-accent-text)', border: 'none', fontWeight: 600 }}>
        Plan now <i className="ti ti-arrow-right" aria-hidden="true" />
      </button>
    </div>
  )
}

function AdaptationBanner({ adaptation }) {
  if (!adaptation) return null
  return (
    <div className={`adaptive-banner ${adaptation.tone}`} style={{ marginBottom: '1.5rem' }}>
      <i className={`ti ${adaptation.icon}`} aria-hidden="true" />
      <span>{adaptation.msg}</span>
    </div>
  )
}

function TodayCard({ plan, sessionState, planStart, onToggle, onBail }) {
  // Drop sessions once they're completed or bailed so the card clears itself —
  // rest days stay (nothing to action) until the day rolls over.
  const todays = getTodaySessions(plan, planStart).filter(({ session, weekNum, idx }) => {
    if (session.zone === 'rest') return true
    const st = sessionState[`w${weekNum}_${idx}`] || {}
    return !st.completed && !st.bailed
  })
  const dateLabel = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  if (!todays.length) return null

  return (
    <div className="card">
      <h2>Today · {dateLabel}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {todays.map(({ session, weekNum, idx }) => {
          const isRest = session.zone === 'rest'
          const state = sessionState[`w${weekNum}_${idx}`] || {}
          const bailed = !!state.bailed && !isRest
          return (
            <div key={idx} className={`sess-${session.zone}`} style={{ borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: bailed ? 0.6 : 1 }}>
              {!isRest && (
                <input
                  type="checkbox"
                  checked={!!state.completed}
                  onChange={() => onToggle(weekNum, idx, session.zone)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--color-accent)', marginTop: 1, flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {(state.completed || bailed) && !isRest
                    ? <span style={{ textDecoration: 'line-through', opacity: 0.55 }}>{session.name}</span>
                    : session.name}
                  {bailed && (
                    <span className="tag" style={{ background: 'var(--color-red-light)', color: 'var(--color-red-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <i className="ti ti-circle-x" style={{ fontSize: 12 }} aria-hidden="true" /> Missed
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.85 }}>{session.desc}</div>
                {!isRest && !state.completed && (
                  <button
                    onClick={() => onBail(weekNum, idx, session.zone)}
                    style={{
                      marginTop: 8, display: 'inline-flex', gap: 5, alignItems: 'center',
                      cursor: 'pointer', fontFamily: 'inherit', background: 'none', border: 'none',
                      padding: 0, fontSize: 11, fontWeight: 600,
                      color: bailed ? 'inherit' : 'var(--color-red-text)', opacity: bailed ? 0.55 : 0.8,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}
                  >
                    {bailed
                      ? <><i className="ti ti-arrow-back-up" style={{ fontSize: 13 }} aria-hidden="true" /> Un-mark missed</>
                      : <><i className="ti ti-circle-x" style={{ fontSize: 13 }} aria-hidden="true" /> Bail</>}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VolumeChart({ plan }) {
  const [hovered, setHovered] = useState(null)
  const maxHrs = Math.max(...plan.map(w => w.hrs || 0), 1)
  const midHrs = Math.round(maxHrs / 2)

  return (
    <div style={{ display: 'flex', gap: 0 }}>
      {/* Y-axis labels */}
      <div style={{ width: 28, flexShrink: 0, position: 'relative', height: CHART_H + 20 }}>
        {[maxHrs, midHrs, 0].map(v => (
          <div key={v} style={{
            position: 'absolute',
            bottom: (v / maxHrs) * CHART_H + 20,
            right: 4,
            fontSize: 9,
            color: 'var(--color-text-faint)',
            lineHeight: 1,
            transform: 'translateY(50%)',
          }}>
            {v}h
          </div>
        ))}
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* Gridlines */}
        {[maxHrs, midHrs].map(v => (
          <div key={v} style={{
            position: 'absolute',
            left: 0, right: 0,
            bottom: (v / maxHrs) * CHART_H + 20,
            borderTop: '1px solid rgba(128,128,128,0.12)',
            pointerEvents: 'none',
          }} />
        ))}

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: CHART_H }}>
          {plan.map((week, i) => {
            const hrs = week.hrs || 0
            const barH = hrs > 0 ? Math.max((hrs / maxHrs) * CHART_H, 3) : 3
            const color = PHASE_COLORS[week.isRecovery ? 'recovery' : week.phase] || '#888'
            const isHov = hovered === i

            return (
              <div
                key={week.num}
                style={{ flex: 1, height: barH, position: 'relative', cursor: 'default' }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                {isHov && (
                  <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: 6,
                    background: 'var(--color-surface)',
                    border: '0.5px solid var(--color-border-strong)',
                    borderRadius: 4,
                    padding: '5px 9px',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                    zIndex: 10,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                    color: 'var(--color-text)',
                    pointerEvents: 'none',
                  }}>
                    <strong>W{week.num}</strong> · {hrs}h
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
                      {week.isRecovery ? 'Recovery' : week.phaseLabel}
                    </div>
                  </div>
                )}
                <div style={{
                  width: '100%',
                  height: '100%',
                  background: `linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 50%), ${color}`,
                  borderRadius: '3px 3px 0 0',
                  opacity: isHov ? 0.8 : 1,
                  transition: 'opacity 0.1s',
                  transformOrigin: 'bottom',
                  animation: `bar-grow 0.55s cubic-bezier(0.2,0.7,0.3,1) both`,
                  animationDelay: `${i * 28}ms`,
                }} />
              </div>
            )
          })}
        </div>

        {/* X-axis labels */}
        <div style={{ display: 'flex', gap: 3, paddingTop: 5 }}>
          {plan.map((week, i) => (
            <div key={week.num} style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 9,
              color: hovered === i ? 'var(--color-text-muted)' : 'var(--color-text-faint)',
            }}>
              {week.num}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StravaCard({ strava }) {
  if (!strava?.configured) return null
  const { account, syncing, syncMsg, onConnect, onSync } = strava
  const connected = !!account
  const lastSynced = account?.last_synced_at
    ? new Date(account.last_synced_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 1.25rem', fontSize: 12, color: 'var(--color-text-muted)' }}>
      <i className="ti ti-brand-strava" style={{ fontSize: 15, color: '#FC4C02', flexShrink: 0 }} aria-hidden="true" />
      {connected ? (
        <>
          <button className="btn btn-sm" onClick={onSync} disabled={syncing}>
            <i className="ti ti-refresh" aria-hidden="true" /> {syncing ? 'Syncing…' : 'Sync rides'}
          </button>
          <span>{lastSynced ? `Last synced ${lastSynced}` : 'Connected'}</span>
          {syncMsg && <span style={{ opacity: 0.85 }}>· {syncMsg}</span>}
        </>
      ) : (
        <>
          <button
            className="btn btn-sm"
            onClick={onConnect}
            style={{ background: '#FC4C02', borderColor: '#FC4C02', color: '#fff' }}
          >
            <i className="ti ti-brand-strava" aria-hidden="true" /> Connect Strava
          </button>
          <span>to attach ride data to each session.</span>
        </>
      )}
    </div>
  )
}

function formMeta(tsb) {
  if (tsb > 8) return { label: 'Fresh', color: 'var(--color-green-text)', bg: 'var(--color-green-light)' }
  if (tsb < -15) return { label: 'Fatigued', color: 'var(--color-red-text)', bg: 'var(--color-red-light)' }
  return { label: 'Balanced', color: 'var(--color-accent-text)', bg: 'var(--color-accent-light)' }
}

function TrainingLoadCard({ plan, sessionState, activities, user, planStart }) {
  const { series, current, hasData, fromRides } = useMemo(
    () => computeTrainingLoad(plan, sessionState, activities, user, planStart),
    [plan, sessionState, activities, user, planStart]
  )

  if (!hasData) {
    return (
      <div className="card">
        <h2>Training load</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Complete a few sessions (or sync some rides) and your fitness, fatigue and form
          curves will build here.
        </p>
      </div>
    )
  }

  const W = 320, H = 140, padL = 6, padR = 6, padT = 14, padB = 20
  const n = series.length
  const maxY = Math.max(1, ...series.map(s => Math.max(s.ctl, s.atl)))
  const xAt = i => n === 1 ? W / 2 : padL + (i / (n - 1)) * (W - padL - padR)
  const yAt = v => padT + (1 - v / maxY) * (H - padT - padB)
  const pathFor = key => series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(s[key]).toFixed(1)}`).join(' ')
  const areaFor = key => {
    if (!n) return ''
    const baseY = (H - padB).toFixed(1)
    return `${pathFor(key)} L ${xAt(n - 1).toFixed(1)} ${baseY} L ${xAt(0).toFixed(1)} ${baseY} Z`
  }
  const fmt = d => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const form = formMeta(current.tsb)

  return (
    <div className="card">
      <h2>Training load</h2>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-accent-text)' }}>{current.ctl}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fitness (CTL)</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-amber-text)' }}>{current.atl}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fatigue (ATL)</div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{current.tsb > 0 ? '+' : ''}{current.tsb}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: form.bg, color: form.color }}>{form.label}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Form (TSB)</div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaFor('ctl')} fill="url(#ctlFill)" stroke="none" />
        <path d={pathFor('ctl')} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathFor('atl')} fill="none" stroke="var(--color-amber-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" />
        {n > 0 && (
          <>
            <text x={padL} y={H - 4} textAnchor="start" fontSize="8" fill="var(--color-text-faint)">{fmt(series[0].date)}</text>
            <text x={W - padR} y={H - 4} textAnchor="end" fontSize="8" fill="var(--color-text-faint)">{fmt(series[n - 1].date)}</text>
          </>
        )}
      </svg>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}>
          <span style={{ width: 14, height: 2, background: 'var(--color-accent)', display: 'inline-block' }} /> Fitness
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}>
          <span style={{ width: 14, height: 2, background: 'var(--color-amber-text)', display: 'inline-block' }} /> Fatigue
        </span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
        {fromRides
          ? 'From your synced rides (power or HR based), estimated from planned zones on days without a ride.'
          : 'Estimated from planned zones + your RPE — sync rides for power-based accuracy.'}
      </p>
    </div>
  )
}

export default function Overview({ user, plan, sessionState = {}, planStart, adaptation, unconfirmed, activities = [], streak, loadCtx, needsPlan, onPlanWeek, onToggle, onBail, onRPE, doneSessions, totalSessions, daysLeft, strava }) {
  // This-week execution — far more relevant than whole-plan totals now.
  const [wkStart, wkEnd] = thisWeekRange()
  const weekSessions = getScheduledSessions(plan, { base: planStart })
    .filter(s => s.date >= wkStart && s.date <= wkEnd)
  const isDone = s => !!sessionState[`w${s.weekNum}_${s.idx}`]?.completed
  const plannedThisWeek = weekSessions.length
  const doneThisWeek = weekSessions.filter(isDone).length
  const plannedHrs = Math.round(weekSessions.reduce((a, s) => a + parseLeadingMinutes(s.session.desc), 0) / 60 * 10) / 10
  const doneHrs = Math.round(weekSessions.filter(isDone).reduce((a, s) => a + parseLeadingMinutes(s.session.desc), 0) / 60 * 10) / 10
  const weekPct = plannedThisWeek ? Math.round((doneThisWeek / plannedThisWeek) * 100) : 0

  return (
    <div>
      {needsPlan && <PlanWeekCTA onPlanWeek={onPlanWeek} />}
      <CatchUpCard unconfirmed={unconfirmed} onToggle={onToggle} onBail={onBail} onRPE={onRPE} />
      <AdaptationBanner adaptation={adaptation} />
      <TodayCard plan={plan} sessionState={sessionState} planStart={planStart} onToggle={onToggle} onBail={onBail} />
      <StreakCard streak={streak} />
      <StravaCard strava={strava} />

      <div className="stats-grid">
        <div className="stat-card"><div className="val">{user.ftp ? user.ftp + 'W' : '—'}</div><div className="lbl">FTP</div></div>
        <div className="stat-card"><div className="val">{plannedThisWeek ? `${doneThisWeek}/${plannedThisWeek}` : '—'}</div><div className="lbl">Sessions this week</div></div>
        <div className="stat-card"><div className="val">{plannedThisWeek ? `${doneHrs}/${plannedHrs}h` : '—'}</div><div className="lbl">Hours this week</div></div>
        <div className="stat-card"><div className="val">{loadCtx?.currentCtl || '—'}</div><div className="lbl">Fitness (CTL)</div></div>
      </div>

      {/* This-week progress bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          <span>This week</span><span>{plannedThisWeek ? `${weekPct}%` : 'Not planned yet'}</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${weekPct}%` }} />
        </div>
      </div>

      {/* Phase legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
        {Object.entries(PHASE_COLORS).map(([phase, color]) => (
          <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ textTransform: 'capitalize' }}>{phase.replace('-', ' ')}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Weekly volume</h2>
        <VolumeChart plan={plan} />
      </div>

      <TrainingLoadCard plan={plan} sessionState={sessionState} activities={activities} user={user} planStart={planStart} />

      <div className="card">
        <h2>Event summary</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
          <div><i className="ti ti-calendar" style={{ marginRight: 6 }} aria-hidden="true" />{user.event_date ? new Date(user.event_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not set'}</div>
          <div><i className="ti ti-map-pin" style={{ marginRight: 6 }} aria-hidden="true" />{user.event_name || 'Event not set'}</div>
          <div><i className="ti ti-route" style={{ marginRight: 6 }} aria-hidden="true" />{user.event_distance_km ? `${user.event_distance_km}km` : 'Distance not set'}</div>
          <div><i className="ti ti-user" style={{ marginRight: 6 }} aria-hidden="true" />Age group: {user.age_group || 'Not set'}</div>
        </div>
      </div>
    </div>
  )
}
