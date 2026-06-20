import { useState } from 'react'
import { getScheduledSessions, downloadICS } from '../lib/schedule'

const ZONE_COLORS = {
  z1: { bg: 'var(--color-teal-light)',   text: 'var(--color-teal-text)',   label: 'Recovery' },
  z2: { bg: 'var(--color-green-light)',  text: 'var(--color-green-text)',  label: 'Endurance (Z2)' },
  z3: { bg: 'var(--color-purple-light)', text: 'var(--color-purple-text)', label: 'Tempo / Sweet spot' },
  z4: { bg: 'var(--color-amber-light)',  text: 'var(--color-amber-text)',  label: 'Threshold' },
  z5: { bg: 'var(--color-red-light)',    text: 'var(--color-red-text)',    label: 'HIIT / VO₂ max' },
}

function buildSessionsByDate(plan, sessionState, base) {
  const map = {}
  getScheduledSessions(plan, { base }).forEach(({ session, date, weekNum, idx }) => {
    const key = date.toISOString().slice(0, 10)
    if (!map[key]) map[key] = []
    map[key].push({
      ...session,
      weekNum,
      idx,
      state: sessionState[`w${weekNum}_${idx}`] || {},
    })
  })
  return map
}

export default function CalendarView({ plan, sessionState, planStart, eventName }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [tooltip, setTooltip] = useState(null) // { key, idx }

  const sessionsByDate = buildSessionsByDate(plan, sessionState, planStart)

  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay = new Date(viewYear, viewMonth + 1, 0)
  // Monday-first grid: how many blank cells before day 1
  const startOffset = (firstDay.getDay() + 6) % 7
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7

  const cells = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startOffset + 1
    if (dayNum < 1 || dayNum > lastDay.getDate()) return null
    const d = new Date(viewYear, viewMonth, dayNum)
    const key = d.toISOString().slice(0, 10)
    return { date: d, key, dayNum, sessions: sessionsByDate[key] || [] }
  })

  const monthLabel = firstDay.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const isToday = d => d && d.toDateString() === today.toDateString()
  const isPast  = d => d && d < today && !isToday(d)

  return (
    <div>
      {/* Export */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <button className="btn btn-sm" onClick={() => downloadICS(plan, eventName || 'Training Plan', planStart)}>
          <i className="ti ti-calendar-plus" aria-hidden="true" /> Add to calendar
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {Object.entries(ZONE_COLORS).map(([zone, c]) => (
          <span key={zone} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, padding: '3px 9px', borderRadius: 20,
            background: c.bg, color: c.text, fontWeight: 500,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.text, opacity: 0.7, flexShrink: 0 }} />
            {c.label}
          </span>
        ))}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11, padding: '3px 9px', borderRadius: 20,
          background: 'var(--color-surface2)', color: 'var(--color-text-faint)', fontWeight: 500,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-text-faint)', opacity: 0.5, flexShrink: 0 }} />
          Completed
        </span>
      </div>

      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <button className="btn btn-sm" onClick={prevMonth} aria-label="Previous month">
          <i className="ti ti-chevron-left" aria-hidden="true" />
        </button>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em' }}>{monthLabel}</span>
        <button className="btn btn-sm" onClick={nextMonth} aria-label="Next month">
          <i className="ti ti-chevron-right" aria-hidden="true" />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3, marginBottom: 3 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} style={{
            textAlign: 'center', fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--color-text-faint)', padding: '3px 0',
          }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 }}>
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} style={{ minHeight: 72 }} />

          const cellToday = isToday(cell.date)
          const cellPast  = isPast(cell.date)
          // Anchor tooltips on the right-hand columns to the right edge so
          // they don't run off the side of a narrow (phone) screen.
          const anchorRight = (i % 7) >= 4

          return (
            <div key={cell.key} className={`cal-cell${cellToday ? ' cal-today' : ''}`} style={{
              minHeight: 72,
              borderRadius: 'var(--radius-sm)',
              padding: '5px 4px',
              background: cellToday ? 'var(--color-accent-light)' : 'var(--color-surface)',
              border: `0.5px solid ${cellToday ? 'var(--color-accent)' : 'var(--color-border)'}`,
              opacity: cellPast && !cell.sessions.length ? 0.45 : 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              position: 'relative',
            }}>
              {/* Day number */}
              <div style={{
                fontSize: 11, fontWeight: cellToday ? 700 : 400, lineHeight: 1,
                color: cellToday ? 'var(--color-accent-text)' : 'var(--color-text-faint)',
                marginBottom: 2,
              }}>
                {cell.dayNum}
              </div>

              {/* Session chips */}
              {cell.sessions.map((s, si) => {
                const c = ZONE_COLORS[s.zone]
                if (!c) return null
                const done = s.state.completed
                const tooltipId = `${cell.key}-${si}`
                const showTip = tooltip === tooltipId

                return (
                  <div key={si} style={{ position: 'relative', minWidth: 0 }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setTooltip(showTip ? null : tooltipId)}
                      onBlur={() => setTooltip(null)}
                      style={{
                        fontSize: 9,
                        padding: '2px 4px',
                        borderRadius: 3,
                        background: done ? 'var(--color-surface2)' : c.bg,
                        color: done ? 'var(--color-text-faint)' : c.text,
                        fontWeight: 600,
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: done ? 'line-through' : 'none',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {done && '✓ '}{s.name}
                    </div>

                    {/* Tooltip */}
                    {showTip && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        ...(anchorRight ? { right: 0 } : { left: 0 }),
                        zIndex: 100,
                        marginTop: 4,
                        background: 'var(--color-surface)',
                        border: '0.5px solid var(--color-border-strong)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '10px 12px',
                        minWidth: 200,
                        maxWidth: 260,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                        pointerEvents: 'none',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                          <span style={{
                            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                            background: done ? 'var(--color-text-faint)' : c.text, flexShrink: 0,
                          }} />
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{s.name}</span>
                          {done && <span style={{ fontSize: 10, color: 'var(--color-text-faint)', fontStyle: 'italic' }}>Completed</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>{s.desc}</div>
                        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--color-text-faint)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Week {s.weekNum} · {c.label}
                          {s.state.rpe && ` · RPE ${s.state.rpe}`}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <p style={{ marginTop: '0.75rem', fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'right' }}>
        Tap a session to see details
      </p>
    </div>
  )
}
