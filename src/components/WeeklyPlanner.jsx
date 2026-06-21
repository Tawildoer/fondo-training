import { useState, useMemo } from 'react'
import { localDateStr } from '../lib/schedule'
import {
  computeWeekTarget, draftWeek, weekTss, buildSession, projectCtl,
  ZONE_OPTIONS, DAY_NAMES,
} from '../lib/weeklyPlanner'

const FOCUS_OPTIONS = [
  { v: 'none', label: 'Balanced' },
  { v: 'endurance', label: 'Endurance' },
  { v: 'threshold', label: 'Threshold' },
  { v: 'climbing', label: 'Climbing' },
  { v: 'recovery', label: 'Recovery week' },
]

function mondayOfWeek(planStart, weekNum) {
  const d = new Date(planStart)
  d.setDate(d.getDate() + (weekNum - 1) * 7)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}
function mondayOf(date) {
  const d = new Date(date)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}
function fmtTime(v) {
  if (!v) return 'Rest'
  return v >= 90 ? `${v / 60} hr` : `${v} min`
}

const ZONE_LABEL = { z1: 'Recovery', z2: 'Endurance', z3: 'Sweet spot', z4: 'Threshold', z5: 'VO₂', rest: 'Rest' }

// Sensible starting point so most weeks are one tap: reuse the last planned
// week's pattern, otherwise a light template from the user's usual days.
function defaultInputs(plannedWeeks, user) {
  const latest = [...(plannedWeeks || [])].sort((a, b) => a.week_num - b.week_num).pop()
  if (latest?.inputs?.days && Object.values(latest.inputs.days).some(v => v > 0)) {
    return {
      days: { ...latest.inputs.days },
      goal: latest.inputs.goal || user.fitness_goal || 'build',
      focus: latest.inputs.focus || 'none',
      freshness: 3, busy: false, // momentary signals reset each week
    }
  }
  const order = ['Sat', 'Tue', 'Thu', 'Sun', 'Wed', 'Mon', 'Fri']
  const n = Math.max(3, Math.min(7, user.days_per_week || 4))
  const days = {}
  order.slice(0, n).forEach(d => { days[d] = d === 'Sat' ? 120 : 60 })
  return { days, goal: user.fitness_goal || 'build', focus: 'none', freshness: 3, busy: false }
}

export default function WeeklyPlanner({ user, planStart, weekNum, plannedWeeks, loadCtx, onSave, onDelete }) {
  const [offset, setOffset] = useState(0) // 0 = this week, 1 = next week
  const activeWeekNum = weekNum + offset
  const weekStart = useMemo(() => mondayOfWeek(planStart, activeWeekNum), [planStart, activeWeekNum])
  const existing = plannedWeeks.find(w => w.week_num === activeWeekNum)

  const [inputs, setInputs] = useState(() => defaultInputs(plannedWeeks, user))
  const [draft, setDraft] = useState(null)
  const [target, setTarget] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const eventDate = user.event_date ? new Date(user.event_date) : null
  const weeksToEvent = eventDate
    ? Math.max(0, Math.round((mondayOf(eventDate) - weekStart) / (7 * 86400000)))
    : null
  const availableMinutes = DAY_NAMES.reduce((s, d) => s + (inputs.days[d] || 0), 0)
  const availDays = DAY_NAMES.filter(d => (inputs.days[d] || 0) > 0).length
  const totalHours = Math.round((availableMinutes / 60) * 10) / 10

  const ctx = useMemo(() => ({
    currentCtl: loadCtx?.currentCtl || 0,
    currentTsb: loadCtx?.currentTsb ?? null,
    recentWeeklyTss: loadCtx?.recentWeeklyTss || 0,
    weeklyHoursStart: user.weekly_hours_start || 0,
    weeksToEvent,
    weekNum: activeWeekNum,
    availableMinutes,
  }), [loadCtx, weeksToEvent, activeWeekNum, availableMinutes, user.weekly_hours_start])

  // Live recommendation (independent of which days you pick) so you know how
  // much to aim for before you even slide the days.
  const suggestion = useMemo(() => computeWeekTarget(inputs, ctx), [inputs, ctx])

  const weekLabel = weekStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  function setDay(day, minutes) {
    setInputs(prev => ({ ...prev, days: { ...prev.days, [day]: minutes } }))
  }

  function generate() {
    const t = computeWeekTarget(inputs, ctx)
    setTarget(t)
    setDraft(draftWeek(t, inputs, user.ftp))
  }

  function editSession(i, patch) {
    setDraft(prev => prev.map((s, idx) => {
      if (idx !== i) return s
      const zone = patch.zone ?? s.zone
      if (zone === 'rest') return buildSession(s.day, 'rest', 0, user.ftp)
      const minutes = patch.minutes ?? (s.durationMin || 60)
      return buildSession(s.day, zone, minutes, user.ftp, s.name === 'Long ride')
    }))
  }

  async function lock() {
    setSaving(true)
    await onSave(activeWeekNum, {
      week_start: localDateStr(weekStart),
      target_tss: target?.targetTss ?? null,
      sessions: draft,
      inputs: { ...inputs, phase: target?.phase, recovery: target?.isRecovery },
      locked_at: new Date().toISOString(),
    })
    setSaving(false)
    setDraft(null); setTarget(null); setEditing(false)
  }

  function startReplan() {
    if (existing?.inputs) setInputs({
      days: existing.inputs.days || {},
      goal: existing.inputs.goal || 'build',
      freshness: existing.inputs.freshness ?? 3,
      focus: existing.inputs.focus || 'none',
      busy: !!existing.inputs.busy,
    })
    setDraft(null); setTarget(null); setEditing(true)
  }

  const draftTss = draft ? weekTss(draft) : 0

  return (
    <div>
      {/* Week selector */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Plan a week</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Week {activeWeekNum} · starting {weekLabel}
            {weeksToEvent != null && <> · <span style={{ color: 'var(--color-accent-text)', fontWeight: 600 }}>{weeksToEvent === 0 ? 'event week' : `${weeksToEvent}w to event`}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn btn-sm ${offset === 0 ? 'btn-primary' : ''}`} onClick={() => { setOffset(0); setDraft(null); setEditing(false) }}>This week</button>
          <button className={`btn btn-sm ${offset === 1 ? 'btn-primary' : ''}`} onClick={() => { setOffset(1); setDraft(null); setEditing(false) }}>Next week</button>
        </div>
      </div>

      {/* Locked view */}
      {existing && !editing && !draft ? (
        <div className="card">
          <h2>Locked in · {existing.inputs?.phase || 'Planned week'}</h2>
          <SessionList sessions={existing.sessions} ftp={user.ftp} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={startReplan}><i className="ti ti-wand" aria-hidden="true" /> Re-plan</button>
            <button className="btn btn-sm btn-danger" onClick={() => onDelete(activeWeekNum)}><i className="ti ti-trash" aria-hidden="true" /> Clear week</button>
          </div>
        </div>
      ) : (
        <>
          {/* Constraints */}
          <div className="card">
            <h2>How much can you ride?</h2>

            {/* Strong volume suggestion (event-aware) */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', marginBottom: 16,
              borderRadius: 'var(--radius-sm)', background: 'var(--grad-hero)', color: '#fff',
            }}>
              <i className="ti ti-target-arrow" style={{ fontSize: 26, color: 'var(--color-electric)', flexShrink: 0 }} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.8 }}>
                  Suggested this week · {suggestion.phase}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                    ~{suggestion.targetHours} h
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>≈ {suggestion.targetTss} TSS · you've set {totalHours} h</span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 3, lineHeight: 1.4 }}>{suggestion.note}</div>
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
              Slide each day to the time you've got. We've started you off — just adjust what's changed.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
              {DAY_NAMES.map(day => {
                const v = inputs.days[day] || 0
                return (
                  <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 34, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: v ? 'var(--color-text)' : 'var(--color-text-faint)' }}>{day}</span>
                    <input
                      type="range" min="0" max="240" step="15" value={v}
                      onChange={e => setDay(day, +e.target.value)}
                      aria-label={`${day} ride time`}
                      style={{ flex: 1, accentColor: 'var(--color-accent)', height: 4 }}
                    />
                    <span style={{ width: 56, textAlign: 'right', fontSize: 12, fontWeight: 600, color: v ? 'var(--color-accent-text)' : 'var(--color-text-faint)' }}>{fmtTime(v)}</span>
                  </div>
                )
              })}
            </div>

            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '6px 0 16px' }}>
              {availDays} day{availDays === 1 ? '' : 's'} · ~{totalHours}h this week
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <label>Goal this week</label>
              <Segmented
                value={inputs.goal}
                onChange={v => setInputs(p => ({ ...p, goal: v }))}
                options={[{ v: 'maintain', label: 'Maintain' }, { v: 'build', label: 'Build' }]}
              />
            </div>

            {/* Secondary, optional choices tucked away to keep things light */}
            <button className="btn btn-sm" onClick={() => setShowDetails(s => !s)} style={{ marginBottom: showDetails ? 14 : 0 }}>
              <i className={`ti ${showDetails ? 'ti-chevron-up' : 'ti-adjustments'}`} aria-hidden="true" /> {showDetails ? 'Hide fine-tuning' : 'Fine-tune (optional)'}
            </button>

            {showDetails && (
              <div>
                <div className="field">
                  <label>How fresh do you feel?</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => setInputs(p => ({ ...p, freshness: n }))}
                        className={`btn btn-sm ${inputs.freshness === n ? 'btn-primary' : ''}`} style={{ flex: 1 }}>{n}</button>
                    ))}
                  </div>
                  <div className="hint">1 = wrecked · 5 = flying</div>
                </div>

                <div className="field">
                  <label>Focus</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {FOCUS_OPTIONS.map(o => (
                      <button key={o.v} onClick={() => setInputs(p => ({ ...p, focus: o.v }))}
                        className={`btn btn-sm ${inputs.focus === o.v ? 'btn-primary' : ''}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={inputs.busy} onChange={e => setInputs(p => ({ ...p, busy: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
                  Busy week — lighten the load
                </label>
              </div>
            )}

            <button className="btn btn-primary" style={{ marginTop: 18, width: '100%', justifyContent: 'center' }} onClick={generate} disabled={availableMinutes === 0}>
              <i className="ti ti-bolt" aria-hidden="true" /> {draft ? 'Regenerate draft' : 'Generate my week'}
            </button>
            {availableMinutes === 0 && <div className="hint" style={{ marginTop: 6 }}>Slide at least one day above Rest to generate a week.</div>}
          </div>

          {/* Draft */}
          {draft && target && (
            <div className="card">
              <h2>Draft · {target.phase}</h2>
              <div className="adaptive-banner hold" style={{ marginBottom: 14 }}>
                <i className="ti ti-info-circle" aria-hidden="true" />
                <span>{target.note} <strong>Target ~{target.targetTss} TSS</strong> · this draft ≈ {draftTss} TSS.</span>
              </div>
              {loadCtx?.currentCtl > 0 && (
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <span>Fitness now: <strong style={{ color: 'var(--color-text)' }}>{loadCtx.currentCtl} CTL</strong></span>
                  <span>→ after this week: <strong style={{ color: projectCtl(loadCtx.currentCtl, draftTss) >= loadCtx.currentCtl ? 'var(--color-green-text)' : 'var(--color-amber-text)' }}>~{projectCtl(loadCtx.currentCtl, draftTss)} CTL</strong></span>
                </div>
              )}
              <SessionList sessions={draft} ftp={user.ftp} editable onEdit={editSession} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn-primary" onClick={lock} disabled={saving}>
                  <i className="ti ti-lock" aria-hidden="true" /> {saving ? 'Locking…' : 'Lock week'}
                </button>
                <button className="btn" onClick={() => { setDraft(null); setTarget(null) }}>Discard</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SessionList({ sessions, ftp, editable, onEdit }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sessions.map((s, i) => (
        <div key={i} className={`sess-${s.zone}`} style={{ borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: s.zone === 'rest' ? 0 : 4, flexWrap: 'wrap' }}>
            <span style={{ width: 34, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6 }}>{s.day}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
            {s.zone !== 'rest' && <span className="tag" style={{ marginLeft: 'auto' }}>{ZONE_LABEL[s.zone]}</span>}
          </div>
          {s.zone !== 'rest' && <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.85 }}>{s.desc}</div>}
          {editable && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {ZONE_OPTIONS.map(o => {
                  const active = s.zone === o.zone
                  return (
                    <button key={o.zone} onClick={() => onEdit(i, { zone: o.zone })}
                      className={o.zone === 'rest' ? '' : `sess-${o.zone}`}
                      style={{
                        padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                        border: `1.5px solid ${active ? 'currentColor' : 'transparent'}`,
                        background: o.zone === 'rest' ? 'var(--color-surface2)' : undefined,
                        color: o.zone === 'rest' ? 'var(--color-text-muted)' : undefined,
                        opacity: active ? 1 : 0.5, transition: 'opacity 0.12s',
                      }}>
                      {o.zone === 'rest' ? 'Rest' : o.zone.toUpperCase()}
                    </button>
                  )
                })}
              </div>
              {s.zone !== 'rest' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <button onClick={() => onEdit(i, { minutes: Math.max(15, (s.durationMin || 60) - 15) })} aria-label="Less time" style={stepBtn}>−</button>
                  <span style={{ minWidth: 56, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>{fmtTime(s.durationMin || 60)}</span>
                  <button onClick={() => onEdit(i, { minutes: Math.min(240, (s.durationMin || 60) + 15) })} aria-label="More time" style={stepBtn}>+</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} className={`btn btn-sm ${value === o.v ? 'btn-primary' : ''}`} style={{ flex: 1 }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const stepBtn = {
  width: 30, height: 30, borderRadius: '50%', border: '0.5px solid var(--color-border-strong)',
  background: 'var(--color-surface2)', color: 'var(--color-text)', fontSize: 18, lineHeight: 1,
  cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
