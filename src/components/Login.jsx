import { useState } from 'react'
import { validateInviteCode, getUserByCode } from '../lib/supabase'

export default function Login({ onSuccess }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')

    const { valid } = await validateInviteCode(code.trim())
    if (!valid) {
      setError('Invalid invite code. Check with Tom if you need access.')
      setLoading(false)
      return
    }

    const existingUser = await getUserByCode(code.trim())
    onSuccess(code.trim().toUpperCase(), existingUser)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      padding: '1.5rem',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--color-accent-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem',
          }}>
            <i className="ti ti-bike" style={{ fontSize: 24, color: 'var(--color-accent-text)' }} aria-hidden="true" />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>
            Cycling Training Planner
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Enter your invite code to get started.
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="code">Invite code</label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. JAMES-RIDE"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                style={{ letterSpacing: '0.05em', fontWeight: 500 }}
              />
              {error && (
                <div style={{ fontSize: 12, color: 'var(--color-red-text)', marginTop: 6, background: 'var(--color-red-light)', borderRadius: 4, padding: '6px 10px' }}>
                  {error}
                </div>
              )}
              <div className="hint">Don't have a code? Ask Tom.</div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Checking…' : 'Continue'}
              {!loading && <i className="ti ti-arrow-right" aria-hidden="true" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
