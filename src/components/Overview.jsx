import { useState } from 'react'
import { getTodaySessions, getScheduledSessions, localDateStr } from '../lib/schedule'
import { RPE_LABELS } from '../lib/planGenerator'
import { parseLeadingMinutes } from '../lib/trainingLoad'
import { WeekCoach, LastRideCoach } from './Coach'

// Monday 00:00 → Sunday 23:59 of the week containing `now`.
function thisWeekRange(now = new Date()) {
  const dow = now.getDay()
  const mon = new Date(now); mon.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow)); mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23, 59, 59, 999)
  return [mon, sun]
}


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

// First-time Strava connect prompt. Once connected, ride sync lives in Training
// weeks (it happens automatically; that's just a manual failsafe).
function StravaCard({ strava }) {
  if (!strava?.configured || strava.account) return null
  const { onConnect } = strava

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 1.25rem', fontSize: 12, color: 'var(--color-text-muted)' }}>
      <i className="ti ti-brand-strava" style={{ fontSize: 15, color: '#FC4C02', flexShrink: 0 }} aria-hidden="true" />
      <button
        className="btn btn-sm"
        onClick={onConnect}
        style={{ background: '#FC4C02', borderColor: '#FC4C02', color: '#fff' }}
      >
        <i className="ti ti-brand-strava" aria-hidden="true" /> Connect Strava
      </button>
      <span>to attach ride data to each session.</span>
    </div>
  )
}

export default function Overview({ user, plan, sessionState = {}, planStart, adaptation, unconfirmed, activities = [], streak, loadCtx, events = [], plannedWeeks = [], realCurrentWeek = 1, needsPlan, onPlanWeek, onToggle, onBail, onRPE, doneSessions, totalSessions, daysLeft, strava }) {
  // This-week execution — far more relevant than whole-plan totals now.
  const [wkStart, wkEnd] = thisWeekRange()
  const weekSessions = getScheduledSessions(plan, { base: planStart })
    .filter(s => s.date >= wkStart && s.date <= wkEnd)
  const isDone = s => !!sessionState[`w${s.weekNum}_${s.idx}`]?.completed
  const plannedThisWeek = weekSessions.length
  const doneThisWeek = weekSessions.filter(isDone).length
  const plannedHrs = Math.round(weekSessions.reduce((a, s) => a + parseLeadingMinutes(s.session.desc), 0) / 60 * 10) / 10
  const doneHrs = Math.round(weekSessions.filter(isDone).reduce((a, s) => a + parseLeadingMinutes(s.session.desc), 0) / 60 * 10) / 10

  // Progress bar counts the whole week including rest days. A rest day
  // auto-completes once it's reached (resting on a rest day *is* sticking to the
  // plan) — but a rest day still in the future doesn't count yet.
  const today0 = new Date(); today0.setHours(0, 0, 0, 0)
  const weekAll = getScheduledSessions(plan, { includeRest: true, base: planStart })
    .filter(s => s.date >= wkStart && s.date <= wkEnd)
  const isComplete = s => (s.session.zone === 'rest' ? s.date <= today0 : isDone(s))
  const barPlanned = weekAll.length
  const weekPct = barPlanned ? Math.round((weekAll.filter(isComplete).length / barPlanned) * 100) : 0

  // Trailing 7 days (rolling) feed the coach — a rolling window avoids the
  // Monday calendar reset and reflects true recent training.
  const win0 = new Date(today0); win0.setDate(win0.getDate() - 6)
  const rollingPlanned = getScheduledSessions(plan, { base: planStart })
    .filter(s => s.date >= win0 && s.date <= today0)
    .map(s => s.session)
  const rollingRides = activities.filter(a => {
    if (!a.start_date) return false
    const d = new Date(a.start_date.slice(0, 10) + 'T00:00:00')
    return d >= win0 && d <= today0
  })

  // Most recent ride + the session it landed on — drives the last-ride coach.
  const latestRide = activities.length
    ? activities.reduce((a, b) => (b.start_date > a.start_date ? b : a))
    : null
  const latestRideSession = latestRide
    ? (getScheduledSessions(plan, { base: planStart })
        .find(s => localDateStr(s.date) === latestRide.start_date.slice(0, 10))?.session || null)
    : null

  return (
    <div>
      {needsPlan && <PlanWeekCTA onPlanWeek={onPlanWeek} />}
      <CatchUpCard unconfirmed={unconfirmed} onToggle={onToggle} onBail={onBail} onRPE={onRPE} />
      <AdaptationBanner adaptation={adaptation} />

      <div className="stats-grid">
        <div className="stat-card"><div className="val">{user.ftp ? user.ftp + 'W' : '—'}</div><div className="lbl">FTP</div></div>
        <div className="stat-card"><div className="val">{plannedThisWeek ? `${doneThisWeek}/${plannedThisWeek}` : '—'}</div><div className="lbl">Sessions this week</div></div>
        <div className="stat-card"><div className="val">{plannedThisWeek ? `${doneHrs}/${plannedHrs}h` : '—'}</div><div className="lbl">Hours this week</div></div>
        <div className="stat-card"><div className="val">{loadCtx?.currentCtl || '—'}</div><div className="lbl">Fitness (CTL)</div></div>
      </div>

      <TodayCard plan={plan} sessionState={sessionState} planStart={planStart} onToggle={onToggle} onBail={onBail} />
      <StravaCard strava={strava} />

      {/* This-week progress bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          <span>This week</span><span>{plannedThisWeek ? `${weekPct}%` : 'Not planned yet'}</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${weekPct}%` }} />
        </div>
      </div>

      {/* At-a-glance coach nudges; deeper charts live in the Analytics tab. */}
      <div className="ov-cols">
        {latestRide && <LastRideCoach activity={latestRide} session={latestRideSession} ftp={user.ftp} />}
        <WeekCoach planned={rollingPlanned} rides={rollingRides} ftp={user.ftp} />
      </div>
    </div>
  )
}
