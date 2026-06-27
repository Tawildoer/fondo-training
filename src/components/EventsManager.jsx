import { useState } from 'react'
import { SPORTS, eventSport } from '../lib/sports'

const EVENT_TYPES = [
  { value: 'gran_fondo', label: 'Gran Fondo', sport: 'bike' },
  { value: 'sportive', label: 'Sportive', sport: 'bike' },
  { value: 'road_race', label: 'Road race', sport: 'bike' },
  { value: 'criterium', label: 'Criterium', sport: 'bike' },
  { value: 'time_trial', label: 'Time trial', sport: 'bike' },
  { value: 'other', label: 'Other', sport: 'bike' },
  { value: 'running', label: 'Running race', sport: 'run' },
  { value: 'tri_sprint', label: 'Triathlon · Sprint', sport: 'tri' },
  { value: 'tri_olympic', label: 'Triathlon · Olympic', sport: 'tri' },
  { value: 'tri_70_3', label: 'Triathlon · 70.3', sport: 'tri' },
  { value: 'tri_ironman', label: 'Triathlon · Ironman', sport: 'tri' },
]
const TYPE_LABEL = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t.label]))

// Grouped for the picker so the three disciplines read clearly.
const TYPE_GROUPS = [
  { sport: 'bike', label: 'Cycling', types: EVENT_TYPES.filter(t => t.sport === 'bike') },
  { sport: 'run', label: 'Running', types: EVENT_TYPES.filter(t => t.sport === 'run') },
  { sport: 'tri', label: 'Triathlon', types: EVENT_TYPES.filter(t => t.sport === 'tri') },
]
// The icon for an event's discipline (triathlon gets its own glyph).
const SPORT_ICON = { bike: SPORTS.bike.icon, run: SPORTS.run.icon, tri: 'ti-trophy' }
const eventIcon = type => SPORT_ICON[eventSport(type)] || 'ti-flag'

const blank = { name: '', date: '', event_type: 'gran_fondo', distance_km: '' }

function daysTo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const ev = new Date(y, m - 1, d); ev.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((ev - today) / 86400000)
}

export default function EventsManager({ events, onAdd, onUpdate, onDelete }) {
  const [editingId, setEditingId] = useState(null) // 'new' | id | null
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)

  const upcoming = [...events].filter(e => daysTo(e.date) >= 0).sort((a, b) => a.date.localeCompare(b.date))
  const past = [...events].filter(e => daysTo(e.date) < 0).sort((a, b) => b.date.localeCompare(a.date))

  function openNew() { setForm(blank); setEditingId('new') }
  function openEdit(e) {
    setForm({ name: e.name || '', date: e.date, event_type: e.event_type || 'gran_fondo', distance_km: e.distance_km || '' })
    setEditingId(e.id)
  }
  function cancel() { setEditingId(null); setForm(blank) }

  async function save() {
    if (!form.date) return
    setSaving(true)
    const fields = {
      name: form.name.trim() || null,
      date: form.date,
      event_type: form.event_type,
      distance_km: form.distance_km ? parseInt(form.distance_km) : null,
    }
    if (editingId === 'new') await onAdd(fields)
    else await onUpdate(editingId, fields)
    setSaving(false)
    cancel()
  }

  const fmtDate = ds => {
    const [y, m, d] = ds.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  function Row({ e }) {
    const dt = daysTo(e.date)
    return (
      <div className="sess-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface2)', flexWrap: 'wrap' }}>
        <i className={`ti ${eventIcon(e.event_type)}`} style={{ fontSize: 16, color: 'var(--color-electric)', flexShrink: 0 }} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{e.name || TYPE_LABEL[e.event_type] || 'Event'}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            {fmtDate(e.date)}{e.distance_km ? ` · ${e.distance_km}km` : ''}{e.event_type ? ` · ${TYPE_LABEL[e.event_type] || e.event_type}` : ''}
          </div>
        </div>
        {dt >= 0 && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-accent-text)', lineHeight: 1 }}>{dt}</div>
            <div style={{ fontSize: 9, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>days</div>
          </div>
        )}
        <button className="btn btn-sm" onClick={() => openEdit(e)}><i className="ti ti-pencil" aria-hidden="true" /> Edit</button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(e.id)}><i className="ti ti-trash" aria-hidden="true" /> Delete</button>
      </div>
    )
  }

  return (
    <div className="card">
      <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>Events</span>
        {editingId === null && (
          <button className="btn btn-sm btn-primary" onClick={openNew}><i className="ti ti-plus" aria-hidden="true" /> Add event</button>
        )}
      </h2>

      {editingId !== null && (
        <div style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Event name</label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Amy's Gran Fondo" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="field">
              <label>Distance (km)</label>
              <input type="number" value={form.distance_km} onChange={e => setForm(f => ({ ...f, distance_km: e.target.value }))} placeholder="optional" min="1" max="500" />
            </div>
          </div>
          <div className="field">
            <label>Type</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {TYPE_GROUPS.map(g => (
                <div key={g.sport}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-faint)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <i className={`ti ${SPORT_ICON[g.sport]}`} aria-hidden="true" /> {g.label}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {g.types.map(t => (
                      <button key={t.value} onClick={() => setForm(f => ({ ...f, event_type: t.value }))}
                        className={`btn btn-sm ${form.event_type === t.value ? 'btn-primary' : ''}`}>{t.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={!form.date || saving}>{saving ? 'Saving…' : (editingId === 'new' ? 'Add event' : 'Save')}</button>
            <button className="btn" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      {events.length === 0 && editingId === null && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          No events yet. Add one and the plan will periodize toward it — building volume as it nears, then tapering. You can also train with no event at all.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {upcoming.map(e => <Row key={e.id} e={e} />)}
        {past.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 6 }}>Past</div>
            {past.map(e => <Row key={e.id} e={e} />)}
          </>
        )}
      </div>
    </div>
  )
}
