import { useState, useMemo } from 'react'
import { localDateStr, nextEvent, prevEvent } from '../lib/schedule'
import {
  computeWeekTarget, draftWeek, projectCtl, buildSession, sportsForWeek, disciplineWeights,
  ZONE_OPTIONS, DAY_NAMES, TIER_MIN, TIER_LABEL, strengthEligible,
} from '../lib/weeklyPlanner'
import { SPORTS } from '../lib/sports'

const LENGTHS = ['S', 'M', 'L']

// Normalize a saved day map to the {length} shape (older weeks stored raw
// minutes, or a {length,type} pair — intensity is now automatic, so type is
// dropped).
function normalizeDays(days = {}) {
  const out = {}
  Object.entries(days).forEach(([day, v]) => {
    if (v && typeof v === 'object') out[day] = { length: v.length || 'M' }
    else if (typeof v === 'number' && v > 0) out[day] = { length: v <= 50 ? 'S' : v <= 110 ? 'M' : 'L' }
  })
  return out
}

// Per-day intensity preview labels (the read-only badge that replaced the
// manual easy/hard toggle).
const ZONE_INTENSITY = { z1: 'Recovery', z2: 'Endurance', z3: 'Sweet-spot', z4: 'Threshold', z5: 'VO₂', strength: 'Strength', rest: 'Rest' }
const intensityLabel = session => {
  if (!session) return ''
  if (session.sport === 'brick') return 'Brick'
  if (session.sport === 'multi') return '2 sessions'
  if (session.name === 'Long ride' || session.name === 'Long run') return 'Long ride'
  return ZONE_INTENSITY[session.zone] || ''
}

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

const ZONE_LABEL = { z1: 'Recovery', z2: 'Endurance', z3: 'Sweet spot', z4: 'Threshold', z5: 'VO₂', strength: 'Strength', rest: 'Rest' }

// Sensible starting point so most weeks are one tap: reuse the last planned
// week's day pattern, otherwise a light template. Intensity is automatic, so
// days only carry a length now.
function defaultInputs(plannedWeeks, user) {
  const latest = [...(plannedWeeks || [])].sort((a, b) => a.week_num - b.week_num).pop()
  const latestDays = latest?.inputs?.days
  const isNewShape = latestDays && Object.values(latestDays).some(v => v && typeof v === 'object')
  if (isNewShape) {
    return {
      days: normalizeDays(latestDays),
      goal: latest.inputs.goal || user.fitness_goal || 'build',
      focus: 'none',
      strength: latest.inputs.strength || 0, // carry the rider's strength choice
      freshness: 3, busy: false, // momentary signals reset each week
    }
  }
  // Template: a long weekend ride + a few midweek days.
  const order = ['Sat', 'Tue', 'Thu', 'Sun', 'Wed', 'Mon', 'Fri']
  const n = Math.max(3, Math.min(7, user.days_per_week || 4))
  const days = {}
  order.slice(0, n).forEach(d => { days[d] = { length: d === 'Sat' ? 'L' : 'M' } })
  return { days, goal: user.fitness_goal || 'build', focus: 'none', strength: 0, freshness: 3, busy: false }
}

export default function WeeklyPlanner({ user, planStart, weekNum, plannedWeeks, sessionState = {}, events = [], loadCtx, onSave, onDelete, onGenerated }) {
  // On the weekend the current (Mon-anchored) week is basically done, so
  // default to planning next week — the one you're about to ride.
  const [offset, setOffset] = useState(() => ([0, 6].includes(new Date().getDay()) ? 1 : 0))
  const activeWeekNum = weekNum + offset
  const weekStart = useMemo(() => mondayOfWeek(planStart, activeWeekNum), [planStart, activeWeekNum])
  const existing = plannedWeeks.find(w => w.week_num === activeWeekNum)

  // Days already done or in the past can't be re-planned — only rides still to
  // come. Indices match draftWeek's Mon→Sun order (= the session index).
  const lockedIdx = useMemo(() => {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const set = new Set()
    DAY_NAMES.forEach((_, i) => {
      const dd = new Date(weekStart); dd.setDate(weekStart.getDate() + i)
      const st = sessionState[`w${activeWeekNum}_${i}`] || {}
      if (dd < today0 || st.completed || st.bailed) set.add(i)
    })
    return set
  }, [weekStart, activeWeekNum, sessionState])

  const [inputs, setInputs] = useState(() => defaultInputs(plannedWeeks, user))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const ev = nextEvent(events, weekStart)
  const weeksToEvent = ev?._date
    ? Math.max(0, Math.round((mondayOf(ev._date) - weekStart) / (7 * 86400000)))
    : null
  const pe = prevEvent(events, weekStart)
  const weeksSinceEvent = pe?._date
    ? Math.max(0, Math.round((weekStart - mondayOf(pe._date)) / (7 * 86400000)))
    : null
  const availableMinutes = DAY_NAMES.reduce((s, d) => s + (inputs.days[d] ? TIER_MIN[inputs.days[d].length] : 0), 0)
  const availDays = DAY_NAMES.filter(d => inputs.days[d]).length
  const totalHours = Math.round((availableMinutes / 60) * 10) / 10

  const ctx = useMemo(() => ({
    currentTsb: loadCtx?.currentTsb ?? null,
    currentCtl: loadCtx?.currentCtl ?? null,  // for the form-aware readiness gate
    recentWeeklyTss: loadCtx?.recentWeeklyTss || 0,
    weeklyHoursStart: user.weekly_hours_start || 0,
    daysPerWeek: user.days_per_week || 5,
    weeksToEvent,
    weeksSinceEvent,
    weekNum: activeWeekNum,
    eventType: ev?.event_type || null,        // drives the auto intensity mix
    riderType: user.riding_strength || 'all_rounder',
  }), [loadCtx, weeksToEvent, weeksSinceEvent, activeWeekNum, user.weekly_hours_start, user.days_per_week, ev, user.riding_strength])

  // Load carried over from a bailed session the previous week that couldn't be
  // recouped within that week — this week absorbs it so misses don't vanish.
  const carryIn = useMemo(() => {
    const prev = plannedWeeks.find(w => w.week_num === activeWeekNum - 1)
    return Math.max(0, Math.round(prev?.inputs?.carryOut || 0))
  }, [plannedWeeks, activeWeekNum])
  const withCarry = t => carryIn > 0
    ? { ...t, targetTss: t.targetTss + carryIn, targetHours: Math.round((t.targetHours + carryIn / 52) * 2) / 2 }
    : t

  // Live recommendation (independent of which days you pick) so you know how
  // much to aim for before you even slide the days.
  const suggestion = useMemo(() => withCarry(computeWeekTarget(inputs, ctx)), [inputs, ctx, carryIn])

  // The week's discipline blend is driven entirely by event proximity — every
  // upcoming event pulls its sport(s) in, weighted by how soon it is, so weeks
  // blend (e.g. mostly bike before a near road race, with some swim/run for a
  // later triathlon). Bike-only weeks carry no per-day sport.
  const weights = useMemo(() => disciplineWeights(events, weekStart), [events, weekStart])
  const sportByDay = useMemo(() => sportsForWeek(inputs, suggestion, weights), [inputs, suggestion, weights])
  const multiSport = useMemo(() => Object.values(sportByDay).some(s => s !== 'bike'), [sportByDay])

  // Live preview of the auto-assigned intensity per day (the same draft Generate
  // commits), so the badges show exactly what each day will be before you save.
  const preview = useMemo(() => draftWeek(suggestion, inputs, user.ftp, weights), [suggestion, inputs, user.ftp, weights])
  const previewByDay = useMemo(() => Object.fromEntries(preview.map(s => [s.day, s])), [preview])

  const weekLabel = weekStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

  function toggleDay(day) {
    setInputs(prev => {
      const days = { ...prev.days }
      if (days[day]) delete days[day]
      else days[day] = { length: day === 'Sat' || day === 'Sun' ? 'L' : 'M' }
      return { ...prev, days }
    })
  }
  function setDayField(day, field, val) {
    setInputs(prev => ({ ...prev, days: { ...prev.days, [day]: { ...prev.days[day], [field]: val } } }))
  }

  // Generate now commits straight to the plan — no draft step. You edit the
  // sessions afterwards from Training weeks.
  async function generate() {
    setSaving(true)
    const t = withCarry(computeWeekTarget(inputs, ctx))
    const draft = draftWeek(t, inputs, user.ftp, weights)
    // Preserve locked days (completed/past) exactly; only redraft the rest.
    const sessions = draft.map((s, i) => lockedIdx.has(i)
      ? (existing?.sessions?.[i] || buildSession(DAY_NAMES[i], 'rest', 0, user.ftp))
      : s)
    await onSave(activeWeekNum, {
      week_start: localDateStr(weekStart),
      target_tss: t.targetTss,
      sessions,
      inputs: { ...inputs, phase: t.phase, recovery: t.isRecovery },
      locked_at: new Date().toISOString(),
    })
    setSaving(false)
    setEditing(false)
    onGenerated?.()
  }

  function startReplan() {
    if (existing?.inputs) setInputs({
      days: normalizeDays(existing.inputs.days),
      goal: existing.inputs.goal || 'build',
      freshness: existing.inputs.freshness ?? 3,
      focus: existing.inputs.focus || 'none',
      strength: existing.inputs.strength || 0,
      busy: !!existing.inputs.busy,
    })
    setEditing(true)
  }

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
          <button className={`btn btn-sm ${offset === 0 ? 'btn-primary' : ''}`} onClick={() => { setOffset(0); setEditing(false) }}>This week</button>
          <button className={`btn btn-sm ${offset === 1 ? 'btn-primary' : ''}`} onClick={() => { setOffset(1); setEditing(false) }}>Next week</button>
        </div>
      </div>

      {/* Locked view */}
      {existing && !editing ? (
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
            <h2>Which days can you ride?</h2>

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
                  <span style={{ fontSize: 12, opacity: 0.85 }}>
                    ≈ {suggestion.targetTss} TSS · you've set {totalHours} h
                    {inputs.strength > 0 && ` · +${inputs.strength} strength`}
                  </span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 3, lineHeight: 1.4 }}>{suggestion.note}</div>
                {suggestion.quality?.reason && (
                  <div title="Why this week looks the way it does" style={{ fontSize: 11, fontWeight: 600, marginTop: 5, display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.4 }}>
                    <i className="ti ti-bolt" style={{ color: 'var(--color-electric)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                    <span>{suggestion.quality.reason}</span>
                  </div>
                )}
                {carryIn > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-electric)', marginTop: 4 }}>
                    +{carryIn} TSS carried over from last week's missed session.
                  </div>
                )}
                {loadCtx?.currentCtl > 0 && (
                  <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
                    Fitness {loadCtx.currentCtl} → ~{projectCtl(loadCtx.currentCtl, suggestion.targetTss)} CTL if you hit it
                  </div>
                )}
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: lockedIdx.size ? 10 : 16 }}>
              Tap the days you can ride and set how long. The intensity mix — endurance vs threshold/VO₂ — is chosen automatically from your event, rider type and fatigue.
            </p>
            {lockedIdx.size > 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                <i className="ti ti-lock" aria-hidden="true" /> Completed and past days are locked — re-planning only changes upcoming days.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
              {DAY_NAMES.map((day, i) => {
                if (lockedIdx.has(i)) {
                  const ex = existing?.sessions?.[i]
                  const st = sessionState[`w${activeWeekNum}_${i}`] || {}
                  const tag = st.completed ? 'Done' : st.bailed ? 'Missed' : 'Past'
                  const summary = ex && ex.zone !== 'rest' ? `${ZONE_LABEL[ex.zone]} · ${fmtTime(ex.durationMin || 0)}` : 'Rest'
                  return (
                    <div key={day} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-surface2)', border: '0.5px solid var(--color-border)', opacity: 0.7,
                    }}>
                      <span style={{ width: 46, textAlign: 'center', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-faint)' }}>{day}</span>
                      <i className="ti ti-lock" style={{ fontSize: 14, color: 'var(--color-text-faint)' }} aria-hidden="true" />
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{summary}</span>
                      <span className="tag" style={{ marginLeft: 'auto' }}>{tag}</span>
                    </div>
                  )
                }
                const d = inputs.days[day]
                const on = !!d
                return (
                  <div key={day} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    background: on ? 'var(--color-surface2)' : 'transparent',
                    border: `0.5px solid ${on ? 'var(--color-border)' : 'transparent'}`,
                  }}>
                    <button
                      onClick={() => toggleDay(day)}
                      style={{
                        width: 46, padding: '5px 0', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                        border: `1.5px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                        background: on ? 'var(--color-accent)' : 'transparent',
                        color: on ? '#fff' : 'var(--color-text-faint)',
                      }}>
                      {day}
                    </button>
                    {on ? (
                      <>
                        <MiniSeg value={d.length} onChange={v => setDayField(day, 'length', v)}
                          options={LENGTHS.map(l => ({ v: l, label: TIER_LABEL[l] }))} />
                        {multiSport && sportByDay[day] && (
                          <span title="Auto-assigned by event proximity" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--color-accent-text)' }}>
                            {(Array.isArray(sportByDay[day]) ? sportByDay[day] : [sportByDay[day]]).map((sp, si) => (
                              <span key={sp} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {si > 0 && <span style={{ opacity: 0.5 }}>+</span>}
                                <i className={`ti ${SPORTS[sp]?.icon || ''}`} aria-hidden="true" /> {SPORTS[sp]?.label}
                              </span>
                            ))}
                          </span>
                        )}
                        {/* Auto-assigned intensity (replaces the easy/hard toggle) */}
                        {previewByDay[day] && intensityLabel(previewByDay[day]) && (
                          <span className={previewByDay[day].zone && previewByDay[day].zone !== 'rest' ? `sess-${previewByDay[day].zone}` : ''}
                            title="Chosen automatically from your event, rider type and fatigue"
                            style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20, letterSpacing: '0.02em' }}>
                            {intensityLabel(previewByDay[day])}
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-faint)' }}>{fmtTime(TIER_MIN[d.length])}</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>Rest</span>
                    )}
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

            {/* Strength is offered only with no event on the near horizon — the
                base/off-season window where durability work off the bike pays off. */}
            {strengthEligible(weeksToEvent) && (
              <div className="field" style={{ marginBottom: 12 }}>
                <label><i className="ti ti-barbell" aria-hidden="true" /> Strength sessions</label>
                <Segmented
                  value={inputs.strength || 0}
                  onChange={v => setInputs(p => ({ ...p, strength: v }))}
                  options={[{ v: 0, label: 'Off' }, { v: 1, label: '1× / wk' }, { v: 2, label: '2× / wk' }]}
                />
                <div className="hint">Added on rest days, away from your hard rides — no extra cycling load.</div>
              </div>
            )}

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

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>
                  <input type="checkbox" checked={inputs.focus === 'recovery'} onChange={e => setInputs(p => ({ ...p, focus: e.target.checked ? 'recovery' : 'none' }))} style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
                  Recovery week — keep everything easy
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={inputs.busy} onChange={e => setInputs(p => ({ ...p, busy: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--color-accent)' }} />
                  Busy week — lighten the load
                </label>
              </div>
            )}

            <button className="btn btn-primary" style={{ marginTop: 18, width: '100%', justifyContent: 'center' }} onClick={generate} disabled={availableMinutes === 0 || saving}>
              <i className="ti ti-bolt" aria-hidden="true" /> {saving ? 'Building…' : (existing ? 'Rebuild this week' : 'Generate my week')}
            </button>
            <div className="hint" style={{ marginTop: 6 }}>
              {availableMinutes === 0 ? 'Tap at least one day to generate a week.' : 'Lands straight in Training weeks — edit any session there.'}
            </div>
          </div>
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
            <span style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {s.parts
                ? s.parts.map(p => <i key={p.sport} className={`ti ${SPORTS[p.sport]?.icon || ''}`} aria-hidden="true" />)
                : (s.sport && s.sport !== 'bike') && <i className={`ti ${SPORTS[s.sport]?.icon || ''}`} aria-hidden="true" />}
              {s.name}
            </span>
            {s.zone !== 'rest' && <span className="tag" style={{ marginLeft: 'auto' }}>{s.sport === 'brick' ? 'Brick' : s.sport === 'multi' ? '2 sessions' : ZONE_LABEL[s.zone]}</span>}
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

function MiniSeg({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '0.5px solid var(--color-border-strong)' }}>
      {options.map((o, i) => {
        const active = value === o.v
        return (
          <button key={o.v} onClick={() => onChange(o.v)}
            style={{
              padding: '5px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              border: 'none', borderLeft: i ? '0.5px solid var(--color-border-strong)' : 'none',
              background: active ? 'var(--color-accent)' : 'var(--color-surface)',
              color: active ? '#fff' : 'var(--color-text-muted)',
            }}>
            {o.label}
          </button>
        )
      })}
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
