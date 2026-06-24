// Top-bar burger menu → slide-out drawer with Account / Settings / Connections.
// Keeps account-level config (and the Strava/Zwift connections) off the main
// pages so the day-to-day view stays focused on training.

import { useState, useEffect } from 'react'

const SECTIONS = [
  { id: 'account', label: 'Account', icon: 'ti-user' },
  { id: 'settings', label: 'Settings', icon: 'ti-settings' },
  { id: 'connections', label: 'Connections', icon: 'ti-plug' },
]

function AccountSection({ user, authEmail, onUpdateProfile, onLogout }) {
  const [name, setName] = useState(user.name || '')
  useEffect(() => { setName(user.name || '') }, [user.name])
  const dirty = name.trim() && name.trim() !== (user.name || '')

  return (
    <div>
      <div className="field">
        <label htmlFor="acc-name">Name</label>
        <input id="acc-name" type="text" value={name} onChange={e => setName(e.target.value)} />
      </div>
      {dirty && (
        <button className="btn btn-primary btn-sm" onClick={() => onUpdateProfile({ name: name.trim() })}>Save name</button>
      )}
      <div className="field" style={{ marginTop: '1.25rem' }}>
        <label>Email</label>
        <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{authEmail || '—'}</div>
      </div>
      <button className="btn btn-sm" onClick={onLogout} style={{ marginTop: '1.5rem', gap: 6 }}>
        <i className="ti ti-logout" aria-hidden="true" /> Log out
      </button>
    </div>
  )
}

function SettingsSection({ user, onUpdateProfile, onUpdateFTP }) {
  const init = () => ({
    ftp: user.ftp ?? '',
    max_hr: user.max_hr ?? '',
    weekly_hours_start: user.weekly_hours_start ?? '',
    days_per_week: user.days_per_week ?? '',
    fitness_goal: user.fitness_goal || 'build',
  })
  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setForm(init()) }, [user.ftp, user.max_hr, user.weekly_hours_start, user.days_per_week, user.fitness_goal])
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false) }

  async function save() {
    setSaving(true)
    const ftp = parseInt(form.ftp)
    if (ftp >= 50 && ftp <= 600 && ftp !== user.ftp) await onUpdateFTP(ftp)
    await onUpdateProfile({
      max_hr: form.max_hr ? parseInt(form.max_hr) : null,
      weekly_hours_start: form.weekly_hours_start ? parseFloat(form.weekly_hours_start) : null,
      days_per_week: form.days_per_week ? parseInt(form.days_per_week) : null,
      fitness_goal: form.fitness_goal,
    })
    setSaving(false)
    setSaved(true)
  }

  return (
    <div>
      <div className="field">
        <label htmlFor="set-ftp">FTP (watts)</label>
        <input id="set-ftp" type="number" min="50" max="600" value={form.ftp} onChange={e => set('ftp', e.target.value)} placeholder="e.g. 250" />
        <div className="hint">Recalculates your zones and plan targets. Re-test every 4–6 weeks.</div>
      </div>
      <div className="field">
        <label htmlFor="set-hr">Max heart rate (bpm)</label>
        <input id="set-hr" type="number" min="120" max="230" value={form.max_hr} onChange={e => set('max_hr', e.target.value)} placeholder="e.g. 188" />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="set-hours">Weekly hours</label>
          <input id="set-hours" type="number" min="1" max="30" step="0.5" value={form.weekly_hours_start} onChange={e => set('weekly_hours_start', e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="set-days">Days / week</label>
          <input id="set-days" type="number" min="1" max="7" value={form.days_per_week} onChange={e => set('days_per_week', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Training goal</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ v: 'maintain', label: 'Maintain' }, { v: 'build', label: 'Build' }].map(o => (
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
      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: 6 }}>
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save settings'}
      </button>
    </div>
  )
}

function Row({ icon, color, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '14px 0', borderBottom: '0.5px solid var(--color-border)' }}>
      <i className={`ti ${icon}`} style={{ fontSize: 20, color, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

function ConnectionsSection({ strava, zwift }) {
  const muted = { fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }
  return (
    <div>
      {/* Strava */}
      <Row icon="ti-brand-strava" color="#FC4C02" title="Strava">
        {!strava?.configured ? (
          <div style={muted}>Strava isn't configured on this deployment.</div>
        ) : strava.account ? (
          <>
            <div style={{ ...muted, marginBottom: 8 }}>
              Connected — rides attach to your sessions automatically.
              {strava.account.last_synced_at && ` Last synced ${new Date(strava.account.last_synced_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}.`}
            </div>
            <button className="btn btn-sm" onClick={strava.onSync} disabled={strava.syncing}>
              <i className="ti ti-refresh" aria-hidden="true" /> {strava.syncing ? 'Syncing…' : 'Sync rides'}
            </button>
            {strava.syncMsg && <div style={{ ...muted, marginTop: 6 }}>{strava.syncMsg}</div>}
          </>
        ) : (
          <>
            <div style={{ ...muted, marginBottom: 8 }}>Attach ride data to each planned session.</div>
            <button className="btn btn-sm" onClick={strava.onConnect} style={{ background: '#FC4C02', borderColor: '#FC4C02', color: '#fff' }}>
              <i className="ti ti-brand-strava" aria-hidden="true" /> Connect Strava
            </button>
          </>
        )}
      </Row>

      {/* Zwift */}
      <Row icon="ti-brand-zwift" color="#FC6719" title="Zwift">
        {!zwift?.hasFtp ? (
          <div style={muted}>Set your FTP (Settings) to send structured workouts to Zwift.</div>
        ) : !zwift.supported ? (
          <div style={muted}>Use <strong>Send to Zwift</strong> on a session to download it — or open this in Chrome/Edge on desktop to auto-sync your week.</div>
        ) : !zwift.linked ? (
          <>
            <div style={{ ...muted, marginBottom: 8 }}>Link your Zwift Workouts folder once, and this week's sessions appear in Zwift's Custom Workouts automatically.</div>
            <button className="btn btn-sm" onClick={zwift.onLink} style={{ background: '#FC6719', borderColor: '#FC6719', color: '#fff' }}>
              <i className="ti ti-brand-zwift" aria-hidden="true" /> Link Zwift folder
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'var(--color-green-text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <i className="ti ti-circle-check" aria-hidden="true" /> Folder linked
              {zwift.status?.error
                ? <span style={{ color: 'var(--color-red-text)', fontWeight: 400 }}>· {zwift.status.error}</span>
                : zwift.status?.count != null && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>· {zwift.status.count} ready</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" onClick={zwift.onSync}><i className="ti ti-refresh" aria-hidden="true" /> Sync now</button>
              <button className="btn btn-sm" onClick={zwift.onUnlink}>Unlink</button>
            </div>
          </>
        )}
      </Row>
    </div>
  )
}

export default function AccountMenu({ user, authEmail, strava, zwift, onUpdateProfile, onUpdateFTP, onLogout }) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState('account')

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button className="hero-btn" onClick={() => setOpen(true)} title="Menu" aria-label="Open menu" style={{ gap: 6 }}>
        <i className="ti ti-menu-2" style={{ fontSize: 18 }} aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className="drawer-backdrop" onClick={() => setOpen(false)} />
          <aside className="drawer" role="dialog" aria-label="Menu">
            <div className="drawer-head">
              <span className="drawer-title">Menu</span>
              <button className="drawer-x" onClick={() => setOpen(false)} aria-label="Close menu"><i className="ti ti-x" /></button>
            </div>
            <div className="drawer-tabs">
              {SECTIONS.map(s => (
                <button key={s.id} className={`drawer-tab ${section === s.id ? 'active' : ''}`} onClick={() => setSection(s.id)}>
                  <i className={`ti ${s.icon}`} aria-hidden="true" /> {s.label}
                </button>
              ))}
            </div>
            <div className="drawer-body">
              {section === 'account' && <AccountSection user={user} authEmail={authEmail} onUpdateProfile={onUpdateProfile} onLogout={onLogout} />}
              {section === 'settings' && <SettingsSection user={user} onUpdateProfile={onUpdateProfile} onUpdateFTP={onUpdateFTP} />}
              {section === 'connections' && <ConnectionsSection strava={strava} zwift={zwift} />}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
