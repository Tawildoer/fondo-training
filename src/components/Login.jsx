import { useState } from 'react'
import { signIn, signUp, getUserByAuthId, sendPasswordReset } from '../lib/supabase'

function friendlyError(msg) {
  if (!msg) return 'Something went wrong. Try again.'
  if (msg.includes('Invalid login credentials')) return 'Incorrect email or password.'
  if (msg.includes('User already registered') || msg.includes('already been registered')) return 'An account with this email already exists. Sign in instead.'
  if (msg.includes('Email not confirmed')) return 'Please confirm your email before signing in.'
  if (msg.includes('Password should be at least')) return 'Password must be at least 6 characters.'
  return msg
}

export default function Login({ onSignedIn, onSignedUp }) {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  function switchMode(m) {
    setMode(m)
    setError('')
    setPassword('')
    setConfirmPassword('')
    setResetSent(false)
  }

  async function handleReset(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await sendPasswordReset(email.trim())
      setResetSent(true)
    } catch (err) {
      setError(friendlyError(err.message))
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (mode === 'signup') {
      if (password !== confirmPassword) { setError('Passwords do not match.'); return }
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    }

    setLoading(true)
    try {
      if (mode === 'signup') {
        const { user, session } = await signUp(email.trim(), password)
        if (!session) {
          // Email confirmation required
          setAwaitingConfirmation(true)
        } else {
          onSignedUp(user)
        }
      } else {
        const { user } = await signIn(email.trim(), password)
        const profile = await getUserByAuthId(user.id)
        if (profile) {
          onSignedIn(profile)
        } else {
          // Auth account exists but no profile — send to onboarding
          onSignedUp(user)
        }
      }
    } catch (err) {
      setError(friendlyError(err.message))
    }
    setLoading(false)
  }

  if (awaitingConfirmation) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: '1.5rem' }}>
        <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
            <i className="ti ti-mail" style={{ fontSize: 22, color: 'var(--color-green-text)' }} aria-hidden="true" />
          </div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>Check your email</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            We sent a confirmation link to <strong>{email}</strong>.<br />
            Click it to activate your account, then come back and sign in.
          </p>
          <button className="btn btn-sm" style={{ marginTop: '1.5rem' }} onClick={() => { setAwaitingConfirmation(false); switchMode('signin') }}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'forgot') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: '1.5rem' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {resetSent ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-green-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                <i className="ti ti-mail" style={{ fontSize: 22, color: 'var(--color-green-text)' }} aria-hidden="true" />
              </div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>Check your email</h2>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                If an account exists for <strong>{email}</strong>, we sent a link to reset your password.<br />
                Open it to choose a new password.
              </p>
              <button className="btn btn-sm" style={{ marginTop: '1.5rem' }} onClick={() => switchMode('signin')}>
                Back to sign in
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                  <i className="ti ti-lock-question" style={{ fontSize: 24, color: 'var(--color-accent-text)' }} aria-hidden="true" />
                </div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>
                  Reset your password
                </h1>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  Enter your email and we'll send you a reset link.
                </p>
              </div>

              <div className="card">
                <form onSubmit={handleReset}>
                  <div className="field">
                    <label htmlFor="reset-email">Email</label>
                    <input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                    />
                  </div>

                  {error && (
                    <div style={{ fontSize: 12, color: 'var(--color-red-text)', background: 'var(--color-red-light)', borderRadius: 4, padding: '7px 10px', marginBottom: 12 }}>
                      {error}
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
                    {loading ? 'Sending…' : 'Send reset link'}
                    {!loading && <i className="ti ti-arrow-right" aria-hidden="true" />}
                  </button>
                </form>
              </div>

              <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                <button className="link-btn" onClick={() => switchMode('signin')} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}>
                  Back to sign in
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: '1.5rem' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--color-accent-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <i className="ti ti-bike" style={{ fontSize: 24, color: 'var(--color-accent-text)' }} aria-hidden="true" />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>
            wattsToCome
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {mode === 'signin' ? 'Sign in to your account.' : 'Create a free account to get started.'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="tabs" style={{ marginBottom: '1.25rem' }}>
          <button className={`tab-btn ${mode === 'signin' ? 'active' : ''}`} onClick={() => switchMode('signin')} style={{ flex: 1 }}>
            Sign in
          </button>
          <button className={`tab-btn ${mode === 'signup' ? 'active' : ''}`} onClick={() => switchMode('signup')} style={{ flex: 1 }}>
            Create account
          </button>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 6 characters' : ''}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
              />
            </div>

            {mode === 'signin' && (
              <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 12 }}>
                <button type="button" className="link-btn" onClick={() => switchMode('forgot')} style={{ background: 'none', border: 'none', color: 'var(--color-accent-text)', fontSize: 12, cursor: 'pointer', padding: 0 }}>
                  Forgot password?
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Same password again"
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            {error && (
              <div style={{ fontSize: 12, color: 'var(--color-red-text)', background: 'var(--color-red-light)', borderRadius: 4, padding: '7px 10px', marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? (mode === 'signup' ? 'Creating account…' : 'Signing in…') : (mode === 'signup' ? 'Create account' : 'Sign in')}
              {!loading && <i className="ti ti-arrow-right" aria-hidden="true" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
