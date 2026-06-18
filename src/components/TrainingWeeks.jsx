import { useState, useEffect } from 'react'
import { getAdaptation, RPE_LABELS } from '../lib/planGenerator'
import { getSessionDate } from '../lib/schedule'
import { matchActivityToDate } from '../lib/strava'
import ActivityDetail from './ActivityDetail'

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

export default function TrainingWeeks({ plan, sessionState, activities = [], onToggle, onRPE, onNote }) {
  const [openWeeks, setOpenWeeks] = useState(() => new Set([plan[0]?.num]))

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
      {plan.map(week => {
        const activeSessions = week.sessions
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.zone !== 'rest')
        const doneCount = activeSessions.filter(({ i }) =>
          sessionState[`w${week.num}_${i}`]?.completed
        ).length
        const isOpen = openWeeks.has(week.num)
        const adaptation = isOpen ? getAdaptation(week.num, sessionState) : null
        const phaseTag = week.isRecovery ? 'recovery' : week.phase

        return (
          <div key={week.num} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <button
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
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Week {week.num}</span>
                  <span className={`tag tag-${phaseTag}`}>
                    {week.isRecovery ? 'Recovery week' : week.phaseLabel}
                  </span>
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
                {adaptation && (
                  <div className={`adaptive-banner ${adaptation.tone}`} style={{ marginBottom: 12 }}>
                    <i className={`ti ${adaptation.icon}`} aria-hidden="true" />
                    <span>{adaptation.msg}</span>
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {week.sessions.map((session, idx) => {
                    const key = `w${week.num}_${idx}`
                    const state = sessionState[key] || {}
                    const isRest = session.zone === 'rest'
                    const matchedActivity = isRest ? null : matchActivityToDate(activities, getSessionDate(week.num, session, idx))

                    return (
                      <div key={idx} className={`sess-${session.zone}`}
                        style={{ borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
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
                                {state.completed && !isRest
                                  ? <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{session.name}</span>
                                  : session.name}
                              </span>
                              {state.completed && !isRest && (
                                <i className="ti ti-circle-check" style={{ fontSize: 14, opacity: 0.7 }} aria-hidden="true" />
                              )}
                            </div>
                            <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.85 }}>{session.desc}</div>

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

                            {matchedActivity && <ActivityDetail activity={matchedActivity} />}
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
