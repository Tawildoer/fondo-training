import { useState, useEffect } from 'react'
import Login from './components/Login'
import Onboarding from './components/Onboarding'
import Dashboard from './components/Dashboard'
import { getUserByCode } from './lib/supabase'

export default function App() {
  const [screen, setScreen] = useState('loading') // loading | login | onboarding | dashboard
  const [user, setUser] = useState(null)

  // Persist login via localStorage (just the invite code)
  useEffect(() => {
    const savedCode = localStorage.getItem('fondo_invite_code')
    if (savedCode) {
      getUserByCode(savedCode).then(userData => {
        if (userData) {
          setUser(userData)
          setScreen('dashboard')
        } else {
          setScreen('login')
        }
      })
    } else {
      setScreen('login')
    }
  }, [])

  function handleValidCode(code, existingUser) {
    localStorage.setItem('fondo_invite_code', code)
    if (existingUser) {
      setUser(existingUser)
      setScreen('dashboard')
    } else {
      setScreen('onboarding')
    }
  }

  function handleOnboardingComplete(newUser) {
    setUser(newUser)
    setScreen('dashboard')
  }

  function handleLogout() {
    localStorage.removeItem('fondo_invite_code')
    setUser(null)
    setScreen('login')
  }

  if (screen === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  if (screen === 'login') return <Login onSuccess={handleValidCode} />
  if (screen === 'onboarding') {
    const code = localStorage.getItem('fondo_invite_code')
    return <Onboarding inviteCode={code} onComplete={handleOnboardingComplete} />
  }
  if (screen === 'dashboard') return <Dashboard user={user} onLogout={handleLogout} onUpdateUser={setUser} />
}
