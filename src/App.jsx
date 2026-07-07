import { useState, useEffect } from 'react'
import Login from './components/Login'
import ResetPassword from './components/ResetPassword'
import Onboarding from './components/Onboarding'
import Dashboard from './components/Dashboard'
import { supabase, getUserByAuthId, signOut } from './lib/supabase'
import { exchangeStravaCode } from './lib/strava'

export default function App() {
  const [screen, setScreen] = useState('loading') // loading | login | onboarding | dashboard | error
  const [user, setUser] = useState(null)       // full profile row from users table
  const [authUser, setAuthUser] = useState(null) // supabase auth user (needed during onboarding)

  useEffect(() => {
    // A password-recovery link lands with a #type=recovery token in the URL.
    // Capture it before Supabase clears the hash so we show the reset screen
    // instead of routing straight into the dashboard.
    const isRecovery = window.location.hash.includes('type=recovery')

    // Handle auth events from anywhere (sign-out, recovery link in another tab).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setScreen('reset-password')
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
        setAuthUser(null)
        setScreen('login')
      }
    })

    if (isRecovery) {
      setScreen('reset-password')
      return () => subscription.unsubscribe()
    }

    // Check for an existing session on mount. Any failure here (network drop,
    // Supabase outage) lands on the error screen with a retry — never an
    // indefinite "Loading…".
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setScreen('login'); return }

      // Handle a Strava OAuth redirect (?code=…&scope=…) landing on the app.
      const params = new URLSearchParams(window.location.search)
      const stravaCode = params.get('code')
      if (stravaCode && params.get('scope')) {
        try { await exchangeStravaCode(stravaCode, params.get('scope')) } catch (e) { console.error('Strava connect failed:', e) }
        window.history.replaceState({}, '', window.location.pathname)
      }

      const profile = await getUserByAuthId(session.user.id)
      if (profile) {
        setUser(profile)
        setScreen('dashboard')
      } else {
        setAuthUser(session.user)
        setScreen('onboarding')
      }
    }).catch(e => {
      console.error('Boot failed:', e)
      setScreen('error')
    })

    return () => subscription.unsubscribe()
  }, [])

  function handleSignedIn(profile) {
    setUser(profile)
    setScreen('dashboard')
  }

  function handleSignedUp(supabaseAuthUser) {
    setAuthUser(supabaseAuthUser)
    setScreen('onboarding')
  }

  function handleOnboardingComplete(newUser) {
    setUser(newUser)
    setScreen('dashboard')
  }

  async function handleLogout() {
    await signOut()
    setUser(null)
    setAuthUser(null)
    setScreen('login')
  }

  if (screen === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <i className="ti ti-bolt boot-bolt" aria-hidden="true" />
        <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  if (screen === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: '1.5rem', textAlign: 'center' }}>
        <i className="ti ti-cloud-off" style={{ fontSize: 30, color: 'var(--color-text-faint)' }} aria-hidden="true" />
        <div style={{ color: 'var(--color-text)', fontSize: 15, fontWeight: 600 }}>Couldn't reach the server</div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Check your connection, then try again.</div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={() => window.location.reload()}>
          <i className="ti ti-refresh" aria-hidden="true" /> Retry
        </button>
      </div>
    )
  }

  if (screen === 'login') return <Login onSignedIn={handleSignedIn} onSignedUp={handleSignedUp} />
  if (screen === 'reset-password') return <ResetPassword onSignedIn={handleSignedIn} onSignedUp={handleSignedUp} />
  if (screen === 'onboarding') return <Onboarding authUser={authUser} onComplete={handleOnboardingComplete} />
  if (screen === 'dashboard') return <Dashboard user={user} authEmail={authUser?.email} onLogout={handleLogout} onUpdateUser={setUser} />
}
