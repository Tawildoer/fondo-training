import { useState } from 'react'
import { RPE_LABELS, getZoneWatts, getRunPace, getSwimPace, fmtPace } from '../lib/planGenerator'
import { getSessionDate } from '../lib/schedule'
import { matchActivityToDate } from '../lib/strava'
import { ZONE_OPTIONS, ZONE_META, buildWorkout, buildStrength, buildSwimSets } from '../lib/weeklyPlanner'
import { SPORTS, sessionSport } from '../lib/sports'
import ActivityDetail from './ActivityDetail'

// A small discipline chip (icon + label) for non-bike session cards.
function SportTag({ sport }) {
  const m = SPORTS[sport]
  if (!m || sport === 'bike') return null
  return (
    <span className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <i className={`ti ${m.icon}`} style={{ fontSize: 12 }} aria-hidden="true" /> {m.label}
    </span>
  )
}

const fmtMin = m => (m >= 90 ? `${Math.round(m / 30) * 30 / 60} hr` : `${m} min`)

// Relative week label — the plan changes week to week, so absolute numbers
// don't help. Current/next/last are named; everything else is its Monday date.
function weekLabel(num, realCurrentWeek, dateStr) {
  const d = num - realCurrentWeek
  if (d === 0) return 'This week'
  if (d === 1) return 'Next week'
  if (d === -1) return 'Last week'
  return `Week of ${dateStr}`
}
const stepBtnSm = {
  width: 26, height: 26, borderRadius: '50%', border: '0.5px solid var(--color-border-strong)',
  background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 16, lineHeight: 1,
  cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

// Inline editor for a planned session (zone pills + duration stepper).
function SessionEditor({ session, onChange }) {
  const mins = session.durationMin || 60
  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid rgba(128,128,128,0.18)' }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {ZONE_OPTIONS.map(o => {
          const active = session.zone === o.zone
          return (
            <button key={o.zone} onClick={() => onChange({ zone: o.zone })}
              className={o.zone === 'rest' ? '' : `sess-${o.zone}`}
              style={{
                padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                border: `1.5px solid ${active ? 'currentColor' : 'transparent'}`,
                background: o.zone === 'rest' ? 'var(--color-surface2)' : undefined,
                color: o.zone === 'rest' ? 'var(--color-text-muted)' : undefined,
                opacity: active ? 1 : 0.5,
              }}>
              {o.zone === 'rest' ? 'Rest' : o.zone.toUpperCase()}
            </button>
          )
        })}
      </div>
      {session.zone !== 'rest' && (() => {
        // Honour the same per-zone duration cap buildSession enforces, so the
        // stepper can't propose a value that silently clamps back to where it
        // was (which looked like a dead button).
        const meta = ZONE_META[session.zone] || ZONE_META.z2
        const atMax = mins >= meta.max
        const atMin = mins <= 15
        return (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button onClick={() => !atMin && onChange({ minutes: Math.max(15, mins - 15) })} disabled={atMin}
              aria-label="Less time" style={{ ...stepBtnSm, opacity: atMin ? 0.4 : 1, cursor: atMin ? 'default' : 'pointer' }}>−</button>
            <span style={{ minWidth: 54, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>{fmtMin(mins)}</span>
            <button onClick={() => !atMax && onChange({ minutes: Math.min(meta.max, mins + 15) })} disabled={atMax}
              aria-label="More time" title={atMax ? `Max for ${session.zone.toUpperCase()} is ${fmtMin(meta.max)}` : undefined}
              style={{ ...stepBtnSm, opacity: atMax ? 0.4 : 1, cursor: atMax ? 'default' : 'pointer' }}>+</button>
          </div>
        )
      })()}
    </div>
  )
}

// Heart-rate zones as a fraction of max HR (Z1…Z5), matching the Analytics tab.
const HR_ZONE_FACTORS = [[0.50, 0.60], [0.60, 0.72], [0.72, 0.82], [0.82, 0.89], [0.89, 1.00]]
const ZONE_INDEX = { z1: 0, z2: 1, z3: 2, z4: 3, z5: 4 }

// Concrete power + heart-rate bands to hold on a steady (non-interval) ride, so
// an expanded Z2 endurance day shows what to actually aim at, not just prose.
// Concrete targets for a steady (non-interval) effort, per sport: watts (bike),
// pace/km (run) or pace/100m (swim) when the threshold is set, with the HR band
// shown for every sport so there's always a target even without pace/power.
function SteadyTargets({ zone, sport = 'bike', ftp, maxHr, thresholdPaceRun, cssSwim }) {
  const Z = zone.toUpperCase()
  const watts = sport === 'bike' && ftp ? getZoneWatts(Z, ftp) : null
  const runP = sport === 'run' ? getRunPace(Z, thresholdPaceRun) : null
  const swimP = sport === 'swim' ? getSwimPace(Z, cssSwim) : null
  const hr = HR_ZONE_FACTORS[ZONE_INDEX[zone]]
  const bpm = maxHr && hr ? `${Math.round(hr[0] * maxHr)}–${Math.round(hr[1] * maxHr)} bpm` : null
  if (!watts && !runP && !swimP && !bpm) return null
  const Cell = ({ label, value }) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 1 }}>{value}</div>
    </div>
  )
  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
      {watts && <Cell label="Power" value={`${watts.lo}–${watts.hi} W`} />}
      {runP && <Cell label="Pace" value={`${fmtPace(runP.fast)}–${fmtPace(runP.slow)} /km`} />}
      {swimP && <Cell label="Pace" value={`${fmtPace(swimP.fast)}–${fmtPace(swimP.slow)} /100m`} />}
      {bpm && <Cell label="Heart rate" value={bpm} />}
    </div>
  )
}

// Interval profile: a silhouette of the session's efforts. Bars are drawn in
// the card's own text colour (the row is already tinted by zone), with width ∝
// duration and height ∝ intensity, so the shape of the workout reads at a glance.
function IntervalProfile({ segments }) {
  const OPACITY = { warmup: 0.30, work: 0.92, recover: 0.20, cooldown: 0.28, steady: 0.55 }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 54, marginTop: 4 }}>
      {segments.map((seg, i) => {
        const h = Math.round(Math.min(1, Math.max(0.16, seg.pct / 1.2)) * 100)
        return (
          <div
            key={i}
            title={`${seg.kind} · ${seg.min} min`}
            style={{
              flexGrow: Math.max(0.5, seg.min), flexBasis: 0, minWidth: 2,
              height: `${h}%`, borderRadius: 2,
              background: 'currentColor', opacity: OPACITY[seg.kind] ?? 0.5,
            }}
          />
        )
      })}
    </div>
  )
}

// Generic block prescription (warm-up → main → … → cool-down), each item with
// a name + detail (+ optional note). Shared by strength, swim and brick details.
function BlockDetail({ blocks }) {
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {blocks.map(block => (
        <div key={block.kind}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6, marginBottom: 5 }}>
            {block.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {block.items.map((it, i) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</span>
                  {it.detail && <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', opacity: 0.85 }}>{it.detail}</span>}
                </div>
                {it.note && <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4, marginTop: 1 }}>{it.note}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Expanded strength session: warm-up → main lifts → accessory → core → cool-down.
const StrengthDetail = ({ session }) => <BlockDetail blocks={buildStrength(session.durationMin).blocks} />
// Expanded swim session: warm-up → main set → cool-down.
const SwimDetail = ({ session }) => <BlockDetail blocks={buildSwimSets(session.zone, session.durationMin).blocks} />

// Expanded brick: the two back-to-back legs (bike then run) with their targets.
function BrickDetail({ session, user }) {
  const legs = session.legs || []
  const blocks = legs.map((leg, i) => ({
    kind: `leg${i}`,
    label: `${i + 1}. ${SPORTS[leg.sport]?.label || leg.sport} · ${fmtMin(leg.durationMin)}`,
    items: [{ name: leg.desc || `${leg.zone.toUpperCase()} effort`, detail: '' }],
  }))
  return (
    <>
      <BlockDetail blocks={blocks} />
      <div style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4, marginTop: 8 }}>
        Transition straight from the bike to the run — quick shoes change, no rest.
      </div>
    </>
  )
}

function ProgressRing({ done, total }) {
  const r = 14
  const circ = 2 * Math.PI * r
  const offset = total > 0 ? circ * (1 - done / total) : circ
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-border)" strokeWidth="2.5" />
      {done > 0 && (
        <circle cx="18" cy="18" r={r} fill="none"
          stroke="var(--color-accent)" strokeWidth="2.5"
          strokeDasharray={circ.toFixed(2)}
          strokeDashoffset={offset.toFixed(2)}
          strokeLinecap="round"
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }} />
      )}
      <text x="18" y="18" textAnchor="middle" dominantBaseline="central"
        fontSize="9" fill="var(--color-text)" fontWeight="600">
        {done}/{total}
      </text>
    </svg>
  )
}

export default function TrainingWeeks({ plan, sessionState, activities = [], planStart, adaptation, currentWeek = 1, realCurrentWeek = 1, user, strava, onToggle, onBail, onRPE, onNote, onEditSession, onDownloadZwo }) {
  // Newest/upcoming week first so the most relevant data is at the top.
  const orderedWeeks = [...plan].sort((a, b) => b.num - a.num)
  const lastSynced = strava?.account?.last_synced_at
    ? new Date(strava.account.last_synced_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null
  const [openWeeks, setOpenWeeks] = useState(() => new Set([orderedWeeks[0]?.num]))
  const [editKey, setEditKey] = useState(null)
  const [openDetails, setOpenDetails] = useState(() => new Set())

  function toggleDetail(key) {
    setOpenDetails(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleWeek(num) {
    setOpenWeeks(prev => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num)
      else next.add(num)
      return next
    })
  }

  return (
    <div>
      {/* Rides sync automatically; this is a manual failsafe. */}
      {strava?.configured && strava.account && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
          <i className="ti ti-brand-strava" style={{ fontSize: 14, color: '#FC4C02', flexShrink: 0 }} aria-hidden="true" />
          <span>{lastSynced ? `Synced ${lastSynced}` : 'Connected'}</span>
          {strava.syncMsg && <span style={{ opacity: 0.85 }}>· {strava.syncMsg}</span>}
          <button className="btn btn-sm" onClick={strava.onSync} disabled={strava.syncing} title="Re-sync Strava workouts">
            <i className="ti ti-refresh" aria-hidden="true" /> {strava.syncing ? 'Syncing…' : 'Sync workouts'}
          </button>
        </div>
      )}
      {orderedWeeks.map(week => {
        const activeSessions = week.sessions
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.zone !== 'rest')
        const doneCount = activeSessions.filter(({ i }) =>
          sessionState[`w${week.num}_${i}`]?.completed
        ).length
        const isOpen = openWeeks.has(week.num)
        const weekAdaptation = (isOpen && adaptation && week.num >= currentWeek) ? adaptation : null
        const phaseTag = week.isRecovery ? 'recovery' : week.phase

        return (
          <div key={week.num} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              className="week-header"
              onClick={() => toggleWeek(week.num)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', background: 'none', border: 'none',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                color: 'var(--color-text)',
              }}
            >
              <ProgressRing done={doneCount} total={activeSessions.length} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, letterSpacing: '-0.01em' }}>{weekLabel(week.num, realCurrentWeek, week.dateStr)}</span>
                  <span className={`tag tag-${phaseTag}`}>
                    {week.isRecovery ? 'Recovery week' : week.phaseLabel}
                  </span>
                  {week.adjusted && (
                    <span className="tag" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      title={week.adjustReason}>
                      <i className="ti ti-wand" style={{ fontSize: 12 }} aria-hidden="true" /> Adjusted
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {week.dateStr} · {week.hrs}h target
                </div>
              </div>
              <i
                className={`ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`}
                style={{ color: 'var(--color-text-muted)', flexShrink: 0, fontSize: 16 }}
                aria-hidden="true"
              />
            </button>

            {isOpen && (
              <div style={{ borderTop: '0.5px solid var(--color-border)', padding: '12px 16px 16px' }}>
                {weekAdaptation && (
                  <div className={`adaptive-banner ${weekAdaptation.tone}`} style={{ marginBottom: 12 }}>
                    <i className={`ti ${weekAdaptation.icon}`} aria-hidden="true" />
                    <span>{weekAdaptation.msg}</span>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {week.sessions.map((session, idx) => {
                    const key = `w${week.num}_${idx}`
                    const state = sessionState[key] || {}
                    const isRest = session.zone === 'rest'
                    const sport = sessionSport(session)
                    const bailed = !!state.bailed && !isRest
                    const matchedActivity = isRest ? null : matchActivityToDate(activities, getSessionDate(week.num, session, idx, planStart), sport)
                    // Every non-rest session is a thin card that opens to its
                    // richer detail; interval sessions also get a workout profile.
                    const expandable = !isRest
                    // Interval profiles apply to bike & run quality sessions; swim,
                    // brick and strength render their own block prescriptions.
                    const structured = expandable && !session.test && (sport === 'bike' || sport === 'run') &&
                      ['z3', 'z4', 'z5'].includes(session.zone) && session.durationMin != null
                    const wk = structured
                      ? buildWorkout(session.zone, session.durationMin, user?.ftp,
                          { sport, thresholdPaceRun: user?.threshold_pace_run, cssSwim: user?.css_swim })
                      : null
                    const detailOpen = expandable && openDetails.has(key)
                    // The whole card toggles the detail; action controls below
                    // stopPropagation so they don't also expand/collapse.
                    const stop = e => e.stopPropagation()

                    // Two-a-day: one day, two separate sessions of different
                    // sports — rendered as side-by-side half-width sport banners.
                    if (session.parts) {
                      return (
                        <div key={idx} className="sess-row"
                          role="button" tabIndex={0} aria-expanded={detailOpen}
                          onClick={() => toggleDetail(key)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDetail(key) } }}
                          style={{ borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--color-surface2)', border: '0.5px solid var(--color-border)', opacity: bailed ? 0.6 : 1, cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <div style={{ paddingTop: 2, width: 18, flexShrink: 0 }}>
                              <input type="checkbox" checked={!!state.completed} onClick={stop}
                                onChange={() => onToggle(week.num, idx, session.zone)}
                                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--color-accent)' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6 }}>{session.day}</span>
                                <span style={{ fontSize: 13, fontWeight: 600, textDecoration: (state.completed || bailed) ? 'line-through' : 'none', opacity: (state.completed || bailed) ? 0.55 : 1 }}>Two sessions</span>
                                {state.completed && <i className="ti ti-circle-check" style={{ fontSize: 14, opacity: 0.7 }} aria-hidden="true" />}
                                {bailed && (
                                  <span className="tag" style={{ background: 'var(--color-red-light)', color: 'var(--color-red-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <i className="ti ti-circle-x" style={{ fontSize: 12 }} aria-hidden="true" /> Missed
                                  </span>
                                )}
                              </div>
                              {/* Half-width banners — one per discipline that day */}
                              <div style={{ display: 'flex', gap: 8 }}>
                                {session.parts.map((p, pi) => (
                                  <div key={pi} className={`sess-${p.zone}`} style={{ flex: 1, minWidth: 0, borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.85 }}>
                                      <i className={`ti ${SPORTS[p.sport]?.icon || ''}`} aria-hidden="true" /> {SPORTS[p.sport]?.label}
                                    </div>
                                    <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3 }}>{p.name}</div>
                                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 1 }}>{fmtMin(p.durationMin)}</div>
                                  </div>
                                ))}
                              </div>
                              {detailOpen && (
                                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
                                  {session.parts.map((p, pi) => (
                                    <div key={pi}>
                                      <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <i className={`ti ${SPORTS[p.sport]?.icon || ''}`} aria-hidden="true" /> {p.name} · {fmtMin(p.durationMin)}
                                      </div>
                                      <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.85 }}>{p.desc}</div>
                                      {p.sport === 'swim'
                                        ? <BlockDetail blocks={buildSwimSets(p.zone, p.durationMin).blocks} />
                                        : <SteadyTargets zone={p.zone} sport={p.sport} ftp={user?.ftp} maxHr={user?.max_hr} thresholdPaceRun={user?.threshold_pace_run} cssSwim={user?.css_swim} />}
                                    </div>
                                  ))}
                                  {!state.completed && (
                                    <button onClick={e => { stop(e); onBail(week.num, idx, session.zone) }}
                                      style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit', background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 600, color: bailed ? 'inherit' : 'var(--color-red-text)', opacity: bailed ? 0.55 : 0.85, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                      {bailed
                                        ? <><i className="ti ti-arrow-back-up" style={{ fontSize: 13 }} aria-hidden="true" /> Un-mark missed</>
                                        : <><i className="ti ti-circle-x" style={{ fontSize: 13 }} aria-hidden="true" /> Bail</>}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div key={idx} className={`sess-${session.zone} sess-row`}
                        role={expandable ? 'button' : undefined}
                        tabIndex={expandable ? 0 : undefined}
                        aria-expanded={expandable ? detailOpen : undefined}
                        onClick={expandable ? () => toggleDetail(key) : undefined}
                        onKeyDown={expandable ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDetail(key) } }) : undefined}
                        style={{ borderRadius: 'var(--radius-sm)', padding: '10px 12px', opacity: bailed ? 0.6 : 1, cursor: expandable ? 'pointer' : 'default' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ paddingTop: 2, width: 18, flexShrink: 0 }}>
                            {!isRest && (
                              <input
                                type="checkbox"
                                checked={!!state.completed}
                                onClick={stop}
                                onChange={() => onToggle(week.num, idx, session.zone)}
                                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                              />
                            )}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6 }}>
                                {session.day}
                              </span>
                              {sport !== 'bike' && !isRest && (
                                <i className={`ti ${SPORTS[sport]?.icon || ''}`} style={{ fontSize: 14, opacity: 0.85 }} aria-hidden="true" title={SPORTS[sport]?.label} />
                              )}
                              <span style={{ fontSize: 13, fontWeight: 600 }}>
                                {(state.completed || bailed) && !isRest
                                  ? <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{session.name}</span>
                                  : session.name}
                              </span>
                              {session.test && (
                                <span className="tag" style={{ background: 'var(--color-electric)', color: '#241f0e', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <i className="ti ti-gauge" style={{ fontSize: 12 }} aria-hidden="true" /> FTP TEST
                                </span>
                              )}
                              {state.completed && !isRest && (
                                <i className="ti ti-circle-check" style={{ fontSize: 14, opacity: 0.7 }} aria-hidden="true" />
                              )}
                              {state.completed && state.auto_completed && !isRest && (
                                <span className="tag" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  title="Auto-completed from a matched Strava ride">
                                  <i className="ti ti-brand-strava" style={{ fontSize: 12 }} aria-hidden="true" /> From Strava
                                </span>
                              )}
                              {bailed && (
                                <span className="tag" style={{ background: 'var(--color-red-light)', color: 'var(--color-red-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <i className="ti ti-circle-x" style={{ fontSize: 12 }} aria-hidden="true" /> Missed
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.85 }}>{session.desc}</div>

                            {detailOpen && (
                              <>
                                {session.test ? (
                                  <div style={{ marginTop: 10 }}>
                                    <SteadyTargets zone="z4" sport="bike" ftp={user?.ftp} maxHr={user?.max_hr} />
                                    <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.9, marginTop: 8 }}>
                                      Warm up, then ride the 20 min as hard as you can hold evenly — pace it like a time trial.
                                      95% of your 20-min average becomes your new FTP, applied automatically once you sync.
                                    </div>
                                  </div>
                                ) : structured ? (
                                  <div style={{ marginTop: 10 }}>
                                    <IntervalProfile segments={wk.segments} />
                                    <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.9, marginTop: 8 }}>{wk.breakdown}</div>
                                  </div>
                                ) : session.zone === 'strength' ? (
                                  <StrengthDetail session={session} />
                                ) : sport === 'swim' ? (
                                  <SwimDetail session={session} />
                                ) : sport === 'brick' ? (
                                  <BrickDetail session={session} user={user} />
                                ) : (
                                  <SteadyTargets zone={session.zone} sport={sport} ftp={user?.ftp} maxHr={user?.max_hr}
                                    thresholdPaceRun={user?.threshold_pace_run} cssSwim={user?.css_swim} />
                                )}

                                {!state.completed && (
                                  <button
                                    onClick={e => { stop(e); onBail(week.num, idx, session.zone) }}
                                    style={{
                                      marginTop: 8, marginRight: 14, display: 'inline-flex', gap: 5, alignItems: 'center',
                                      cursor: 'pointer', fontFamily: 'inherit', background: 'none', border: 'none',
                                      padding: 0, fontSize: 11, fontWeight: 600,
                                      color: 'inherit', opacity: bailed ? 0.55 : 0.85,
                                      textTransform: 'uppercase', letterSpacing: '0.05em',
                                    }}
                                  >
                                    {bailed
                                      ? <><i className="ti ti-arrow-back-up" style={{ fontSize: 13 }} aria-hidden="true" /> Un-mark missed</>
                                      : <><i className="ti ti-circle-x" style={{ fontSize: 13 }} aria-hidden="true" /> Bail</>}
                                  </button>
                                )}

                                {onEditSession && (
                                  <button
                                    onClick={e => { stop(e); setEditKey(editKey === `${week.num}_${idx}` ? null : `${week.num}_${idx}`) }}
                                    style={{
                                      marginTop: 8, display: 'inline-flex', gap: 5, alignItems: 'center',
                                      cursor: 'pointer', fontFamily: 'inherit', background: 'none', border: 'none',
                                      padding: 0, fontSize: 11, fontWeight: 600, color: 'inherit', opacity: 0.7,
                                      textTransform: 'uppercase', letterSpacing: '0.05em',
                                    }}
                                  >
                                    <i className={`ti ${editKey === `${week.num}_${idx}` ? 'ti-check' : 'ti-pencil'}`} style={{ fontSize: 13 }} aria-hidden="true" />
                                    {editKey === `${week.num}_${idx}` ? ' Done editing' : ' Edit session'}
                                  </button>
                                )}
                                {onDownloadZwo && user?.ftp && sport === 'bike' && !session.test && (
                                  <button
                                    onClick={e => { stop(e); onDownloadZwo(session, week.num, idx) }}
                                    style={{
                                      marginTop: 8, marginLeft: 14, display: 'inline-flex', gap: 5, alignItems: 'center',
                                      cursor: 'pointer', fontFamily: 'inherit', background: 'none', border: 'none',
                                      padding: 0, fontSize: 11, fontWeight: 600, color: 'inherit', opacity: 0.7,
                                      textTransform: 'uppercase', letterSpacing: '0.05em',
                                    }}
                                  >
                                    <i className="ti ti-download" style={{ fontSize: 13 }} aria-hidden="true" /> Send to Zwift
                                  </button>
                                )}

                                {onEditSession && editKey === `${week.num}_${idx}` && (
                                  <div onClick={stop}>
                                    <SessionEditor session={session} onChange={patch => onEditSession(week.num, idx, patch)} />
                                  </div>
                                )}

                                {state.completed && (
                                  <div onClick={stop} style={{ marginTop: 10, paddingTop: 8, borderTop: '0.5px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.65 }}>
                                      RPE
                                    </span>
                                    {[1, 2, 3, 4, 5].map(r => (
                                      <button
                                        key={r}
                                        onClick={() => onRPE(week.num, idx, r, session.zone)}
                                        style={{
                                          padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                                          cursor: 'pointer', fontFamily: 'inherit',
                                          border: `1.5px solid ${state.rpe === r ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                                          background: state.rpe === r ? 'var(--color-accent)' : 'transparent',
                                          color: state.rpe === r ? '#fff' : 'inherit',
                                        }}
                                      >
                                        {r}
                                      </button>
                                    ))}
                                    {state.rpe && (
                                      <span style={{ fontSize: 11, fontStyle: 'italic', opacity: 0.75 }}>
                                        {RPE_LABELS[state.rpe]}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {matchedActivity && (
                                  <div onClick={stop}>
                                    <ActivityDetail activity={matchedActivity} session={session} ftp={user?.ftp} maxHr={user?.max_hr} />
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {expandable && (
                            <i className={`ti ${detailOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`}
                              style={{ fontSize: 16, opacity: 0.6, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
