import { useState } from 'react'
import { supabase, updatePassword, getUserByAuthId } from '../lib/supabase'

function friendlyError(msg) {
  if (!msg) return 'Something went wrong. Try again.'
  if (msg.includes('Password should be at least')) return 'Password must be at least 6 characters.'
  if (msg.includes('New password should be different')) return 'Choose a password different from your old one.'
  if (msg.includes('Auth session missing') || msg.includes('expired')) {
    return 'This reset link has expired. Request a new one from the sign-in screen.'
  }
  return msg
}

export default function ResetPassword({ onSignedIn, onSignedUp }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }

    setLoading(true)
    try {
      await updatePassword(password)
      // The recovery link already established a session — route into the app.
      const { data: { session } } = await supabase.auth.getSession()
      // Clear the recovery token from the URL.
      window.history.replaceState({}, '', window.location.pathname)
      if (session) {
        const profile = await getUserByAuthId(session.user.id)
        if (profile) onSignedIn(profile)
        else onSignedUp(session.user)
      } else {
        onSignedUp(null)
      }
    } catch (err) {
      setError(friendlyError(err.message))
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <i className="ti ti-lock-cog" style={{ fontSize: 24, color: 'var(--color-accent-text)' }} aria-hidden="true" />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>
            Choose a new password
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Enter a new password for your account.
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input
                id="confirm-new-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Same password again"
                autoComplete="new-password"
                required
              />
            </div>

            {error && (
              <div style={{ fontSize: 12, color: 'var(--color-red-text)', background: 'var(--color-red-light)', borderRadius: 4, padding: '7px 10px', marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Saving…' : 'Save new password'}
              {!loading && <i className="ti ti-check" aria-hidden="true" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
