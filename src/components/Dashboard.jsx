import { useState, useEffect, useCallback } from 'react'
import { generatePlan } from '../lib/planGenerator'
import { loadSessionState, upsertSessionState, loadAdjustments, addAdjustment, deleteAdjustment, updateUser } from '../lib/supabase'
import TrainingWeeks from './TrainingWeeks'
import PowerZones from './PowerZones'
import Nutrition from './Nutrition'
import Adjustments from './Adjustments'
import Overview from './Overview'

export default function Dashboard({ user, onLogout, onUpdateUser }) {
  const [tab, setTab] = useState('overview')
  const [plan, setPlan] = useState([])
  const [sessionState, setSessionState] = useState({}) // { 'w1_0': { completed, rpe, zone } }
  const [adjustments, setAdjustments] = useState([])
  const [loading, setLoading] = useState(true)

  const raceDate = user.event_date ? new Date(user.event_date) : null
  const daysLeft = raceDate ? Math.ceil((raceDate - new Date()) / (1000 * 60 * 60 * 24)) : null

  // Generate plan from user profile
  useEffect(() => {
    setPlan(generatePlan(user))
  }, [user])

  // Load persisted state from Supabase
  useEffect(() => {
    if (!user?.id) return
    Promise.all([loadSessionState(user.id), loadAdjustments(user.id)]).then(([sessions, adjs]) => {
      const stateMap = {}
      sessions.forEach(s => {
        const key = `w${s.week_num}_${s.session_idx}`
        stateMap[key] = { completed: s.completed, rpe: s.rpe, zone: null }
      })
      setSessionState(stateMap)
      setAdjustments(adjs)
      setLoading(false)
    })
  }, [user?.id])

  // Annotate session state with zone (from plan)
  useEffect(() => {
    if (!plan.length) return
    setSessionState(prev => {
      const next = { ...prev }
      plan.forEach(week => {
        week.sessions.forEach((s, i) => {
          const key = `w${week.num}_${i}`
          if (next[key]) next[key].zone = s.zone
          else if (s.zone !== 'rest') next[key] = { ...next[key], zone: s.zone }
        })
      })
      return next
    })
  }, [plan])

  const toggleSession = useCallback(async (weekNum, idx, zone) => {
    const key = `w${weekNum}_${idx}`
    const current = sessionState[key] || {}
    const newCompleted = !current.completed
    const now = newCompleted ? new Date().toISOString() : null
    setSessionState(prev => ({ ...prev, [key]: { ...prev[key], completed: newCompleted, zone } }))
    await upsertSessionState(user.id, weekNum, idx, { completed: newCompleted, completed_at: now })
  }, [sessionState, user.id])

  const setRPE = useCallback(async (weekNum, idx, rpe, zone) => {
    const key = `w${weekNum}_${idx}`
    setSessionState(prev => ({ ...prev, [key]: { ...prev[key], rpe, zone } }))
    await upsertSessionState(user.id, weekNum, idx, { rpe })
  }, [user.id])

  async function handleAddAdjustment(adj) {
    await addAdjustment(user.id, adj)
    const adjs = await loadAdjustments(user.id)
    setAdjustments(adjs)
  }

  async function handleDeleteAdjustment(id) {
    await deleteAdjustment(id)
    setAdjustments(prev => prev.filter(a => a.id !== id))
  }

  async function handleUpdateFTP(newFTP) {
    const updated = { ...user, ftp: newFTP }
    await updateUser(user.id, { ftp: newFTP })
    onUpdateUser(updated)
    setPlan(generatePlan(updated))
  }

  const totalSessions = plan.reduce((a, w) => a + w.sessions.filter(s => s.zone !== 'rest').length, 0)
  const doneSessions = Object.values(sessionState).filter(s => s?.completed).length

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'training', label: 'Training weeks' },
    { id: 'zones', label: 'Power zones' },
    { id: 'nutrition', label: 'Nutrition' },
    { id: 'adjustments', label: 'Adjustments' },
  ]

  return (
    <div className="app-shell">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
            {user.event_name || 'Training Plan'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {user.name} · {user.event_distance_km ? `${user.event_distance_km}km` : ''} {user.event_date ? `· ${new Date(user.event_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {daysLeft !== null && (
            <div style={{ background: 'var(--color-accent-light)', borderRadius: 'var(--radius-sm)', padding: '8px 14px', textAlign: 'right' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-accent-text)', lineHeight: 1 }}>{daysLeft}</div>
              <div style={{ fontSize: 10, color: 'var(--color-accent-text)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>days left</div>
            </div>
          )}
          <button className="btn btn-sm" onClick={onLogout} title="Switch user">
            <i className="ti ti-logout" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
          Loading your plan…
        </div>
      ) : (
        <>
          {tab === 'overview' && <Overview user={user} plan={plan} doneSessions={doneSessions} totalSessions={totalSessions} daysLeft={daysLeft} />}
          {tab === 'training' && <TrainingWeeks plan={plan} sessionState={sessionState} onToggle={toggleSession} onRPE={setRPE} />}
          {tab === 'zones' && <PowerZones user={user} onUpdateFTP={handleUpdateFTP} />}
          {tab === 'nutrition' && <Nutrition user={user} />}
          {tab === 'adjustments' && <Adjustments user={user} adjustments={adjustments} plan={plan} onAdd={handleAddAdjustment} onDelete={handleDeleteAdjustment} onUpdateFTP={handleUpdateFTP} />}
        </>
      )}
    </div>
  )
}
