import { useState } from 'react'
import { createUser } from '../lib/supabase'
import { localDateStr } from '../lib/schedule'

const EVENT_TYPES = [
  { value: 'gran_fondo', label: 'Gran Fondo', icon: 'ti-mountain' },
  { value: 'sportive', label: 'Sportive / Charity ride', icon: 'ti-heart' },
  { value: 'road_race', label: 'Road race', icon: 'ti-flag' },
  { value: 'criterium', label: 'Criterium', icon: 'ti-rotate-clockwise' },
  { value: 'time_trial', label: 'Time trial', icon: 'ti-clock' },
  { value: 'other', label: 'Other', icon: 'ti-bike' },
]

const STRENGTHS = [
  { value: 'sprinter', label: 'Sprinter', desc: 'Strong short efforts, fast finishes' },
  { value: 'climber', label: 'Climber', desc: 'Good at sustained uphill power' },
  { value: 'time_trialist', label: 'Time trialist', desc: 'Steady sustained effort, aero' },
  { value: 'all_rounder', label: 'All-rounder', desc: 'Balanced across all terrain' },
]

const AGE_GROUPS = ['18–34', '35–39', '40–44', '45–49', '50–54', '55–59', '60+']

const STEPS = [
  { id: 'name', title: 'Welcome', subtitle: 'First, what\'s your name?' },
  { id: 'event', title: 'Your event', subtitle: 'Tell us about what you\'re training for.' },
  { id: 'fitness', title: 'Your fitness', subtitle: 'Help us calibrate your training zones.' },
  { id: 'schedule', title: 'Your schedule', subtitle: 'How much can you train?' },
  { id: 'confirm', title: 'All set', subtitle: 'Here\'s your plan summary.' },
]

export default function Onboarding({ authUser, onComplete }) {
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    name: '',
    event_name: '',
    event_date: '',
    event_distance_km: '',
    event_type: '',
    weeks_available: '',
    ftp: '',
    max_hr: '',
    age_group: '',
    riding_strength: '',
    weekly_hours_start: '6',
    days_per_week: '5',
    planning_mode: 'fixed',
    fitness_goal: 'build',
  })

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function next() { setStep(s => Math.min(s + 1, STEPS.length - 1)) }
  function back() { setStep(s => Math.max(s - 1, 0)) }

  function weeksUntilEvent() {
    if (!form.event_date) return ''
    const days = Math.ceil((new Date(form.event_date) - new Date()) / (1000 * 60 * 60 * 24))
    return Math.max(1, Math.floor(days / 7))
  }

  async function handleSubmit() {
    setSaving(true)
    setError('')
    try {
      const weeks = form.weeks_available || weeksUntilEvent() || 13
      const profile = {
        name: form.name.trim(),
        auth_id: authUser.id,
        event_name: form.event_name || null,
        event_date: form.event_date || null,
        event_distance_km: form.event_distance_km ? parseInt(form.event_distance_km) : null,
        event_type: form.event_type || 'other',
        weeks_available: parseInt(weeks),
        ftp: form.ftp ? parseInt(form.ftp) : null,
        max_hr: form.max_hr ? parseInt(form.max_hr) : null,
        age_group: form.age_group || null,
        riding_strength: form.riding_strength || 'all_rounder',
        weekly_hours_start: parseFloat(form.weekly_hours_start) || 6,
        days_per_week: parseInt(form.days_per_week) || 5,
        planning_mode: form.planning_mode,
        fitness_goal: form.fitness_goal,
        plan_start_date: localDateStr(new Date()),
      }
      const newUser = await createUser(profile)
      onComplete(newUser)
    } catch (err) {
      setError('Something went wrong saving your profile. Try again.')
      setSaving(false)
    }
  }

  const progress = ((step + 1) / STEPS.length) * 100

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, marginBottom: '2rem', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'var(--color-accent)', borderRadius: 2, transition: 'width 0.3s' }} />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Step {step + 1} of {STEPS.length}
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 4 }}>{STEPS[step].title}</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{STEPS[step].subtitle}</p>
        </div>

        {/* Step 0 — Name */}
        {step === 0 && (
          <div className="card">
            <div className="field">
              <label>Your name</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. James" autoFocus />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={next} disabled={!form.name.trim()}>
                Next <i className="ti ti-arrow-right" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Step 1 — Event */}
        {step === 1 && (
          <div className="card">
            <div className="field">
              <label>Event name</label>
              <input type="text" value={form.event_name} onChange={e => set('event_name', e.target.value)} placeholder="e.g. Amy's Gran Fondo" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>Event date</label>
                <input type="date" value={form.event_date} onChange={e => { set('event_date', e.target.value); if (!form.weeks_available && e.target.value) { const w = Math.max(1, Math.floor((new Date(e.target.value) - new Date()) / (1000*60*60*24*7))); set('weeks_available', String(w)); } }} />
              </div>
              <div className="field">
                <label>Distance (km)</label>
                <input type="number" value={form.event_distance_km} onChange={e => set('event_distance_km', e.target.value)} placeholder="e.g. 122" min="1" max="500" />
              </div>
            </div>
            <div className="field">
              <label>Event type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                {EVENT_TYPES.map(et => (
                  <button key={et.value} onClick={() => set('event_type', et.value)}
                    style={{
                      padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: `1.5px solid ${form.event_type === et.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: form.event_type === et.value ? 'var(--color-accent-light)' : 'var(--color-surface2)',
                      color: form.event_type === et.value ? 'var(--color-accent-text)' : 'var(--color-text)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                    }}>
                    <i className={`ti ${et.icon}`} style={{ fontSize: 16 }} aria-hidden="true" />
                    {et.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Weeks available to train</label>
              <input type="number" value={form.weeks_available} onChange={e => set('weeks_available', e.target.value)} placeholder="e.g. 13" min="4" max="52" />
              {form.event_date && <div className="hint">Based on your event date: ~{weeksUntilEvent()} weeks</div>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn" onClick={back}><i className="ti ti-arrow-left" aria-hidden="true" /> Back</button>
              <button className="btn btn-primary" onClick={next}>
                {form.event_type ? 'Next' : 'Skip — no event'} <i className="ti ti-arrow-right" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Fitness */}
        {step === 2 && (
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field">
                <label>FTP (watts)</label>
                <input type="number" value={form.ftp} onChange={e => set('ftp', e.target.value)} placeholder="e.g. 250" min="50" max="600" />
                <div className="hint">Leave blank if unsure</div>
              </div>
              <div className="field">
                <label>Max HR (bpm)</label>
                <input type="number" value={form.max_hr} onChange={e => set('max_hr', e.target.value)} placeholder="e.g. 185" min="130" max="230" />
                <div className="hint">Leave blank if unsure</div>
              </div>
            </div>
            <div className="field">
              <label>Age group</label>
              <select value={form.age_group} onChange={e => set('age_group', e.target.value)}>
                <option value="">Select…</option>
                {AGE_GROUPS.map(ag => <option key={ag} value={ag}>{ag}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Riding strength</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {STRENGTHS.map(s => (
                  <button key={s.value} onClick={() => set('riding_strength', s.value)}
                    style={{
                      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                      border: `1.5px solid ${form.riding_strength === s.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: form.riding_strength === s.value ? 'var(--color-accent-light)' : 'var(--color-surface2)',
                      color: form.riding_strength === s.value ? 'var(--color-accent-text)' : 'var(--color-text)',
                      cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                    }}>
                    <div>
                      <div style={{ fontWeight: 600, marginBottom: 1 }}>{s.label}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{s.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn" onClick={back}><i className="ti ti-arrow-left" aria-hidden="true" /> Back</button>
              <button className="btn btn-primary" onClick={next}>Next <i className="ti ti-arrow-right" aria-hidden="true" /></button>
            </div>
          </div>
        )}

        {/* Step 3 — Schedule */}
        {step === 3 && (
          <div className="card">
            <div className="field">
              <label>Starting weekly volume</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="range" min="3" max="15" step="0.5" value={form.weekly_hours_start}
                  onChange={e => set('weekly_hours_start', e.target.value)}
                  style={{ flex: 1 }} />
                <span style={{ fontSize: 16, fontWeight: 600, minWidth: 50 }}>{form.weekly_hours_start}h</span>
              </div>
              <div className="hint">How many hours you're riding per week right now</div>
            </div>
            <div className="field" style={{ marginTop: '1.5rem' }}>
              <label>Days per week available</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[3, 4, 5, 6, 7].map(d => (
                  <button key={d} onClick={() => set('days_per_week', String(d))}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 'var(--radius-sm)',
                      border: `1.5px solid ${form.days_per_week === String(d) ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: form.days_per_week === String(d) ? 'var(--color-accent-light)' : 'var(--color-surface2)',
                      color: form.days_per_week === String(d) ? 'var(--color-accent-text)' : 'var(--color-text)',
                      cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
                    }}>
                    {d}
                  </button>
                ))}
              </div>
              <div className="hint">Including long ride day</div>
            </div>

            <div className="field" style={{ marginTop: '1.5rem' }}>
              <label>Planning style</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { v: 'fixed', label: 'Fixed plan', desc: 'A full periodised plan built up front, with adaptive tweaks.' },
                  { v: 'weekly', label: 'Guided weekly', desc: 'Plan week-to-week around your real schedule. Most flexible.' },
                ].map(o => (
                  <button key={o.v} onClick={() => set('planning_mode', o.v)}
                    style={{
                      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                      border: `1.5px solid ${form.planning_mode === o.v ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: form.planning_mode === o.v ? 'var(--color-accent-light)' : 'var(--color-surface2)',
                      color: form.planning_mode === o.v ? 'var(--color-accent-text)' : 'var(--color-text)',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}>
                    <div style={{ fontWeight: 600, marginBottom: 1 }}>{o.label}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{o.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {form.planning_mode === 'weekly' && (
              <div className="field">
                <label>Goal</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ v: 'maintain', label: 'Maintain fitness' }, { v: 'build', label: 'Build fitness' }].map(o => (
                    <button key={o.v} onClick={() => set('fitness_goal', o.v)}
                      style={{
                        flex: 1, padding: '10px 6px', borderRadius: 'var(--radius-sm)',
                        border: `1.5px solid ${form.fitness_goal === o.v ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        background: form.fitness_goal === o.v ? 'var(--color-accent-light)' : 'var(--color-surface2)',
                        color: form.fitness_goal === o.v ? 'var(--color-accent-text)' : 'var(--color-text)',
                        cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                      }}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
              <button className="btn" onClick={back}><i className="ti ti-arrow-left" aria-hidden="true" /> Back</button>
              <button className="btn btn-primary" onClick={next}>Review <i className="ti ti-arrow-right" aria-hidden="true" /></button>
            </div>
          </div>
        )}

        {/* Step 4 — Confirm */}
        {step === 4 && (
          <div>
            <div className="card">
              <h2>Your plan at a glance</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '1rem' }}>
                {[
                  ['Athlete', form.name],
                  ['Event', form.event_name || '—'],
                  ['Distance', form.event_distance_km ? `${form.event_distance_km}km` : '—'],
                  ['Weeks', form.weeks_available || weeksUntilEvent() || 13],
                  ['FTP', form.ftp ? `${form.ftp}W` : 'Not set'],
                  ['Max HR', form.max_hr ? `${form.max_hr}bpm` : 'Not set'],
                  ['Starting volume', `${form.weekly_hours_start}h/week`],
                  ['Training days', `${form.days_per_week} days/week`],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--color-surface2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
              {error && <div style={{ fontSize: 13, color: 'var(--color-red-text)', background: 'var(--color-red-light)', borderRadius: 4, padding: '8px 12px', marginBottom: 12 }}>{error}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn" onClick={back}><i className="ti ti-arrow-left" aria-hidden="true" /> Back</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                  {saving ? 'Building your plan…' : 'Start training'} {!saving && <i className="ti ti-check" aria-hidden="true" />}
                </button>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-faint)', textAlign: 'center', marginTop: 8 }}>
              You can update your FTP and other settings from the dashboard at any time.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
