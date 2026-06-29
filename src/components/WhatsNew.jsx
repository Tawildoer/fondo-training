import { useState, useEffect } from 'react'

// ───────────────────────────────────────────────────────────────────────────
// WEEKLY RELEASE NOTE — to publish a new one, edit just this object:
//   • bump `id` to any new unique string (the date works well) — this is what
//     re-shows the modal once for every user, replacing the previous note.
//   • set `date` (header label) and rewrite `changes`.
// Each user sees only the current note, once. Old notes are not replayed.
// ───────────────────────────────────────────────────────────────────────────
const RELEASE = {
  id: '2026-06-29.4',
  date: '29 June 2026',
  changes: [
    { tag: 'Planner', text: 'Adaptive intensity — weekly quality (sweet-spot / threshold / VO₂) is auto-prescribed from event type, rider profile, phase and current fatigue. The manual easy/hard control is removed.' },
    { tag: 'Planner', text: 'Form-gated load — intensity is withheld under deep fatigue and reintroduced as form (TSB) recovers.' },
    { tag: 'Analytics', text: 'Automatic FTP — estimated from synced power and updated on meaningful drift; a 20-minute test is scheduled every ~4 weeks.' },
    { tag: 'Training', text: 'Strength — optional 1–2 sessions per week, scheduled when no event is near.' },
    { tag: 'Training', text: 'Multi-sport — running and triathlon plans, with proximity-weighted swim/bike/run distribution and brick sessions.' },
    { tag: 'App', text: 'Installable — add wattsToCome to the home screen and run it full-screen.' },
  ],
}

const STORAGE_KEY = 'wtc_whatsnew_seen'

function platform() {
  const ua = navigator.userAgent || ''
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}
function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

const STEPS = {
  ios: [
    'In Safari, tap the Share button (square with an up-arrow).',
    'Select "Add to Home Screen".',
    'Confirm with "Add", then open it from the new icon.',
  ],
  android: [
    'In Chrome, open the ⋮ menu (top-right).',
    'Select "Install app" (or "Add to Home screen").',
    'Confirm, then open it from the new icon.',
  ],
  desktop: [
    'Open wattsToCome in your phone’s browser.',
    'iOS: Share → "Add to Home Screen". Android: ⋮ menu → "Install app".',
  ],
}

// Fixed-width category column so every row's tag aligns into a clean table.
const tagCell = {
  width: 78, flexShrink: 0, paddingTop: 1,
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--color-accent-text)',
}

export default function WhatsNew() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem(STORAGE_KEY) !== RELEASE.id) setOpen(true) } catch { /* ignore */ }
  }, [])

  function close() {
    try { localStorage.setItem(STORAGE_KEY, RELEASE.id) } catch { /* ignore */ }
    setOpen(false)
  }

  if (!open) return null
  const installed = isStandalone()

  return (
    <div className="drawer-backdrop" onClick={close} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Release notes"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', maxWidth: 460, width: '100%', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 18px 50px rgba(0,0,0,0.4)' }}>

        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-faint)' }}>Release notes</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, letterSpacing: '-0.01em' }}>Recent updates</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>{RELEASE.date}</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <i className="ti ti-x" style={{ fontSize: 19 }} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: '14px 20px' }}>
          <div>
            {RELEASE.changes.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '10px 0', borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
                <span style={tagCell}>{c.tag}</span>
                <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>{c.text}</span>
              </div>
            ))}
          </div>

          {!installed ? (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-faint)', marginBottom: 8 }}>Install on phone</div>
              <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {STEPS[platform()].map((s, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>{s}</li>)}
              </ol>
            </div>
          ) : (
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--color-text-muted)' }}>Running as the installed app.</div>
          )}

          <button className="btn btn-primary" onClick={close} style={{ marginTop: 18, width: '100%', justifyContent: 'center' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
