import { useState, useEffect } from 'react'

// Bump this string to re-show the modal after a future batch of changes.
const WHATS_NEW_VERSION = '2026-06-29'
const STORAGE_KEY = 'wtc_whatsnew_seen'

const HIGHLIGHTS = [
  { icon: 'ti-bolt', text: 'Smarter planner — no more easy/hard guesswork. It auto-picks your threshold / VO₂ days from your event, rider type and fatigue.' },
  { icon: 'ti-activity', text: "Form-aware — it eases off when you're buried, and opens up a quality day once your form has recovered." },
  { icon: 'ti-gauge', text: 'Auto-FTP — your FTP updates itself from your rides, with a 20-min test scheduled roughly monthly.' },
  { icon: 'ti-barbell', text: 'Strength sessions — opt into 1–2 a week when no event is near.' },
  { icon: 'ti-run', text: 'Multi-sport — running & triathlon plans too (auto-mixed swim / bike / run, plus brick sessions).' },
  { icon: 'ti-device-mobile', text: 'Installable app — add wattsToCome to your home screen (steps below).' },
]

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
    'In Safari, tap the Share button (the square with an up-arrow).',
    'Scroll down and tap "Add to Home Screen".',
    'Tap "Add" — then open it from the new icon.',
  ],
  android: [
    'In Chrome, tap the ⋮ menu (top-right).',
    'Tap "Install app" (or "Add to Home screen").',
    'Confirm — then open it from the new icon.',
  ],
  desktop: [
    'Open wattsToCome in your phone’s browser.',
    'iPhone: Share → "Add to Home Screen". Android: ⋮ menu → "Install app".',
  ],
}

export default function WhatsNew() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try { if (localStorage.getItem(STORAGE_KEY) !== WHATS_NEW_VERSION) setOpen(true) } catch { /* ignore */ }
  }, [])

  function close() {
    try { localStorage.setItem(STORAGE_KEY, WHATS_NEW_VERSION) } catch { /* ignore */ }
    setOpen(false)
  }

  if (!open) return null
  const plat = platform()
  const installed = isStandalone()

  return (
    <div className="drawer-backdrop" onClick={close} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="What's new"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', maxWidth: 440, width: '100%', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 18px 50px rgba(0,0,0,0.4)' }}>
        <div style={{ background: 'var(--grad-hero)', color: '#fff', padding: '18px 20px', borderRadius: 'var(--radius) var(--radius) 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.8 }}>What's new</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.2 }}>A big few days of upgrades ⚡</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 4, opacity: 0.85, flexShrink: 0 }}>
            <i className="ti ti-x" style={{ fontSize: 20 }} aria-hidden="true" />
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {HIGHLIGHTS.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <i className={`ti ${h.icon}`} style={{ fontSize: 18, color: 'var(--color-electric)', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                <span style={{ fontSize: 13, lineHeight: 1.45 }}>{h.text}</span>
              </div>
            ))}
          </div>

          {!installed ? (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
                <i className="ti ti-device-mobile" style={{ color: 'var(--color-electric)' }} aria-hidden="true" /> Add it to your home screen
              </div>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {STEPS[plat].map((s, i) => <li key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>{s}</li>)}
              </ol>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 8 }}>It launches full-screen with its own icon — like a native app.</div>
            </div>
          ) : (
            <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--color-text-muted)' }}>You're already running the installed app — nice. ⚡</div>
          )}

          <button className="btn btn-primary" onClick={close} style={{ marginTop: 18, width: '100%', justifyContent: 'center' }}>Got it</button>
        </div>
      </div>
    </div>
  )
}
