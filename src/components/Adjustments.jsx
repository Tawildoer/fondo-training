import { useState } from 'react'

const CHANGE_TYPES = [
  { value: 'reduced_volume', label: 'Reduced volume', icon: 'ti-trending-down' },
  { value: 'sick', label: 'Illness / injury', icon: 'ti-heart-off' },
  { value: 'travel', label: 'Travel', icon: 'ti-plane' },
  { value: 'extra_rest', label: 'Extra rest', icon: 'ti-zzz' },
  { value: 'other', label: 'Other', icon: 'ti-dots' },
]

function changeTypeLabel(val) {
  return CHANGE_TYPES.find(t => t.value === val)?.label || val
}
function changeTypeIcon(val) {
  return CHANGE_TYPES.find(t => t.value === val)?.icon || 'ti-dots'
}

export default function Adjustments({ user, adjustments, plan, onAdd, onDelete, onUpdateFTP }) {
  const [form, setForm] = useState({ week_num: '', change_type: '', hours_completed: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [ftpInput, setFtpInput] = useState('')
  const [ftpSaving, setFtpSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.change_type) return
    setSaving(true)
    await onAdd({
      week_num: form.week_num ? parseInt(form.week_num) : null,
      change_type: form.change_type,
      hours_completed: form.hours_completed ? parseFloat(form.hours_completed) : null,
      notes: form.notes.trim() || null,
    })
    setForm({ week_num: '', change_type: '', hours_completed: '', notes: '' })
    setSaving(false)
  }

  async function handleDelete(id) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id)
      return
    }
    await onDelete(id)
    setDeleteConfirm(null)
  }

  async function handleFTPUpdate(e) {
    e.preventDefault()
    const parsed = parseInt(ftpInput)
    if (!parsed || parsed < 50 || parsed > 600) return
    setFtpSaving(true)
    await onUpdateFTP(parsed)
    setFtpInput('')
    setFtpSaving(false)
  }

  const canAdd = !!form.change_type

  return (
    <div>
      {/* FTP update */}
      <div className="card">
        <h2>Update FTP</h2>
        <form onSubmit={handleFTPUpdate} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="adj-ftp">New FTP (watts)</label>
            <input
              id="adj-ftp"
              type="number"
              value={ftpInput}
              onChange={e => setFtpInput(e.target.value)}
              placeholder={user.ftp ? `Current: ${user.ftp}W` : 'e.g. 250'}
              min="50" max="600"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={ftpSaving || !ftpInput}>
            {ftpSaving ? 'Saving…' : 'Update'}
          </button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--color-text-faint)', marginTop: 8 }}>
          Log an FTP update after a ramp test or 20-minute effort. This updates your power zones and plan targets immediately.
        </p>
      </div>

      {/* Log an adjustment */}
      <div className="card">
        <h2>Log a week change</h2>
        <form onSubmit={handleAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label htmlFor="adj-week">Week</label>
              <select id="adj-week" value={form.week_num} onChange={e => setField('week_num', e.target.value)}>
                <option value="">All weeks / general</option>
                {plan.map(week => (
                  <option key={week.num} value={week.num}>
                    Week {week.num} — {week.isRecovery ? 'Recovery' : week.phaseLabel}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="adj-hours">Hours completed</label>
              <input
                id="adj-hours"
                type="number"
                value={form.hours_completed}
                onChange={e => setField('hours_completed', e.target.value)}
                placeholder="e.g. 4.5"
                min="0" max="40" step="0.5"
              />
            </div>
          </div>

          <div className="field">
            <label>Change type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {CHANGE_TYPES.map(ct => (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => setField('change_type', ct.value)}
                  style={{
                    padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                    border: `1.5px solid ${form.change_type === ct.value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: form.change_type === ct.value ? 'var(--color-accent-light)' : 'var(--color-surface2)',
                    color: form.change_type === ct.value ? 'var(--color-accent-text)' : 'var(--color-text)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                  }}
                >
                  <i className={`ti ${ct.icon}`} aria-hidden="true" />
                  {ct.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="adj-notes">Notes (optional)</label>
            <textarea
              id="adj-notes"
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder="e.g. Caught a cold, missed Thu/Sat sessions. Feeling better now."
              rows={2}
              style={{ resize: 'vertical' }}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving || !canAdd}>
            {saving ? 'Saving…' : (
              <><i className="ti ti-plus" aria-hidden="true" /> Log change</>
            )}
          </button>
        </form>
      </div>

      {/* Log */}
      <div className="card">
        <h2>Change log</h2>
        {adjustments.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            No adjustments logged yet. Use this to track when life gets in the way — illness, travel, or reduced load weeks.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {adjustments.map(adj => (
              <div key={adj.id} style={{ padding: '12px 0', borderBottom: '0.5px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <i className={`ti ${changeTypeIcon(adj.change_type)}`} style={{ fontSize: 16, color: 'var(--color-text-muted)' }} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{changeTypeLabel(adj.change_type)}</span>
                    {adj.week_num && (
                      <span className="tag" style={{ background: 'var(--color-surface2)', color: 'var(--color-text-muted)' }}>
                        Week {adj.week_num}
                      </span>
                    )}
                    {adj.hours_completed != null && (
                      <span className="tag" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent-text)' }}>
                        {adj.hours_completed}h done
                      </span>
                    )}
                  </div>
                  {adj.notes && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: 2 }}>{adj.notes}</div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
                    {new Date(adj.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <button
                  className={`btn btn-sm ${deleteConfirm === adj.id ? 'btn-danger' : ''}`}
                  onClick={() => handleDelete(adj.id)}
                  title={deleteConfirm === adj.id ? 'Click again to confirm delete' : 'Delete'}
                  style={{ flexShrink: 0 }}
                >
                  {deleteConfirm === adj.id ? (
                    <><i className="ti ti-trash" aria-hidden="true" /> Confirm</>
                  ) : (
                    <i className="ti ti-trash" aria-hidden="true" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
