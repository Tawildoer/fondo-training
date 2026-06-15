import { useState } from 'react'
import { getAdaptation, RPE_LABELS } from '../lib/planGenerator'

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

export default function TrainingWeeks({ plan, sessionState, onToggle, onRPE }) {
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
