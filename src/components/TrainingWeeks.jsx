import { useState, useEffect } from 'react'
import { RPE_LABELS } from '../lib/planGenerator'
import { getSessionDate } from '../lib/schedule'
import { matchActivityToDate } from '../lib/strava'
import { ZONE_OPTIONS, ZONE_META } from '../lib/weeklyPlanner'
import ActivityDetail from './ActivityDetail'

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

function NotesField({ note, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note || '')

  useEffect(() => { setDraft(note || '') }, [note])

  function save() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== (note || '')) onSave(trimmed)
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        placeholder="How did it go? Anything to remember…"
        rows={2}
        style={{
          width: '100%', marginTop: 8, padding: '7px 10px', fontSize: 12,
          fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical',
          border: '0.5px solid var(--color-border-strong)', borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none',
        }}
      />
    )
  }

  if (note) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{
          marginTop: 8, display: 'flex', gap: 7, alignItems: 'flex-start', width: '100%',
          textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
          background: 'rgba(0,0,0,0.04)', border: 'none', borderRadius: 'var(--radius-sm)',
          padding: '7px 10px', fontSize: 12, lineHeight: 1.5, color: 'inherit',
        }}
      >
        <i className="ti ti-note" style={{ fontSize: 13, opacity: 0.6, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <span style={{ opacity: 0.9 }}>{note}</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      style={{
        marginTop: 8, display: 'inline-flex', gap: 5, alignItems: 'center',
        cursor: 'pointer', fontFamily: 'inherit', background: 'none', border: 'none',
        padding: 0, fontSize: 11, fontWeight: 600, color: 'inherit', opacity: 0.55,
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}
    >
      <i className="ti ti-pencil-plus" style={{ fontSize: 13 }} aria-hidden="true" /> Add note
    </button>
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

export default function TrainingWeeks({ plan, sessionState, activities = [], planStart, adaptation, currentWeek = 1, realCurrentWeek = 1, user, onToggle, onBail, onRPE, onNote, onEditSession }) {
  // Newest/upcoming week first so the most relevant data is at the top.
  const orderedWeeks = [...plan].sort((a, b) => b.num - a.num)
  // Coach insight only on the most recent ride — a single reminder pointed at
  // the next session, not a verdict on every past ride.
  const latestRide = activities.length
    ? activities.reduce((a, b) => (b.start_date > a.start_date ? b : a))
    : null
  const [openWeeks, setOpenWeeks] = useState(() => new Set([orderedWeeks[0]?.num]))
  const [editKey, setEditKey] = useState(null)

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
                    const bailed = !!state.bailed && !isRest
                    const matchedActivity = isRest ? null : matchActivityToDate(activities, getSessionDate(week.num, session, idx, planStart))

                    return (
                      <div key={idx} className={`sess-${session.zone} sess-row`}
                        style={{ borderRadius: 'var(--radius-sm)', padding: '10px 12px', opacity: bailed ? 0.6 : 1 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ paddingTop: 2, width: 18, flexShrink: 0 }}>
                            {!isRest && (
                              <input
                                type="checkbox"
                                checked={!!state.completed}
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
                              <span style={{ fontSize: 13, fontWeight: 600 }}>
                                {(state.completed || bailed) && !isRest
                                  ? <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{session.name}</span>
                                  : session.name}
                              </span>
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

                            {!isRest && !state.completed && (
                              <button
                                onClick={() => onBail(week.num, idx, session.zone)}
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

                            {!isRest && onEditSession && (
                              <button
                                onClick={() => setEditKey(editKey === `${week.num}_${idx}` ? null : `${week.num}_${idx}`)}
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
                            {onEditSession && editKey === `${week.num}_${idx}` && (
                              <SessionEditor session={session} onChange={patch => onEditSession(week.num, idx, patch)} />
                            )}

                            {state.completed && !isRest && (
                              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '0.5px solid rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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

                            {!isRest && (
                              <NotesField
                                note={state.notes}
                                onSave={text => onNote(week.num, idx, text, session.zone)}
                              />
                            )}

                            {matchedActivity && <ActivityDetail activity={matchedActivity} session={session} ftp={user?.ftp} maxHr={user?.max_hr} showCoach={!!latestRide && matchedActivity.strava_id === latestRide.strava_id} />}
                          </div>
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
