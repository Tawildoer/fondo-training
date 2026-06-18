import { useState, useEffect, useCallback, useRef } from 'react'
import { generatePlan } from '../lib/planGenerator'
import { loadSessionState, upsertSessionState, loadAdjustments, addAdjustment, deleteAdjustment, updateUser, loadFtpHistory, addFtpEntry, getStravaAccount, loadActivities } from '../lib/supabase'
import { syncStrava, getStravaAuthUrl, stravaConfigured } from '../lib/strava'
import TrainingWeeks from './TrainingWeeks'
import PowerZones from './PowerZones'
import Adjustments from './Adjustments'
import Overview from './Overview'
import CalendarView from './CalendarView'
import PlanGuide from './PlanGuide'

export default function Dashboard({ user, onLogout, onUpdateUser }) {
  const [tab, setTab] = useState('overview')
  const [plan, setPlan] = useState([])
  const [sessionState, setSessionState] = useState({}) // { 'w1_0': { completed, rpe, notes, zone } }
  const [adjustments, setAdjustments] = useState([])
  const [ftpHistory, setFtpHistory] = useState([])
  const [activities, setActivities] = useState([])
  const [stravaAccount, setStravaAccount] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const autoSyncedRef = useRef(false)

  const raceDate = user.event_date ? new Date(user.event_date) : null
  const daysLeft = raceDate ? Math.ceil((raceDate - new Date()) / (1000 * 60 * 60 * 24)) : null

  // Generate plan from user profile
  useEffect(() => {
    setPlan(generatePlan(user))
  }, [user])

  // Load persisted state from Supabase
  useEffect(() => {
    if (!user?.id) return
    Promise.all([
      loadSessionState(user.id),
      loadAdjustments(user.id),
      loadFtpHistory(user.id),
      getStravaAccount(user.id),
      loadActivities(user.id),
    ]).then(([sessions, adjs, ftps, strava, acts]) => {
      const stateMap = {}
      sessions.forEach(s => {
        const key = `w${s.week_num}_${s.session_idx}`
        stateMap[key] = { completed: s.completed, bailed: s.bailed, rpe: s.rpe, notes: s.notes, zone: null }
      })
      setSessionState(stateMap)
      setAdjustments(adjs)
      setFtpHistory(ftps)
      setStravaAccount(strava)
      setActivities(acts)
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

  // Auto-sync Strava once per session if the last sync is stale (> 1h).
  useEffect(() => {
    if (autoSyncedRef.current || !stravaAccount) return
    const last = stravaAccount.last_synced_at ? new Date(stravaAccount.last_synced_at).getTime() : 0
    if (Date.now() - last > 60 * 60 * 1000) {
      autoSyncedRef.current = true
      handleSyncStrava()
    }
  }, [stravaAccount])

  const toggleSession = useCallback(async (weekNum, idx, zone) => {
    const key = `w${weekNum}_${idx}`
    const current = sessionState[key] || {}
    const newCompleted = !current.completed
    const now = newCompleted ? new Date().toISOString() : null
    // Completing a session clears any "bailed" mark — they're mutually exclusive.
    setSessionState(prev => ({ ...prev, [key]: { ...prev[key], completed: newCompleted, bailed: newCompleted ? false : prev[key]?.bailed, zone } }))
    await upsertSessionState(user.id, weekNum, idx, { completed: newCompleted, completed_at: now, ...(newCompleted ? { bailed: false } : {}) })
  }, [sessionState, user.id])

  const bailSession = useCallback(async (weekNum, idx, zone) => {
    const key = `w${weekNum}_${idx}`
    const current = sessionState[key] || {}
    const newBailed = !current.bailed
    // Bailing clears completion (and its timestamp); un-bailing just lifts the mark.
    setSessionState(prev => ({ ...prev, [key]: { ...prev[key], bailed: newBailed, completed: newBailed ? false : prev[key]?.completed, zone } }))
    await upsertSessionState(user.id, weekNum, idx, { bailed: newBailed, ...(newBailed ? { completed: false, completed_at: null } : {}) })
  }, [sessionState, user.id])

  const setRPE = useCallback(async (weekNum, idx, rpe, zone) => {
    const key = `w${weekNum}_${idx}`
    setSessionState(prev => ({ ...prev, [key]: { ...prev[key], rpe, zone } }))
    await upsertSessionState(user.id, weekNum, idx, { rpe })
  }, [user.id])

  const setNote = useCallback(async (weekNum, idx, notes, zone) => {
    const key = `w${weekNum}_${idx}`
    setSessionState(prev => ({ ...prev, [key]: { ...prev[key], notes, zone } }))
    await upsertSessionState(user.id, weekNum, idx, { notes })
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
    const entry = await addFtpEntry(user.id, newFTP)
    if (entry) setFtpHistory(prev => [...prev, entry])
    onUpdateUser(updated)
    setPlan(generatePlan(updated))
  }

  function handleConnectStrava() {
    window.location.href = getStravaAuthUrl()
  }

  async function handleSyncStrava() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await syncStrava()
      const [acts, strava] = await Promise.all([loadActivities(user.id), getStravaAccount(user.id)])
      setActivities(acts)
      setStravaAccount(strava)
      setSyncMsg(res.imported ? `Imported ${res.imported} ride${res.imported === 1 ? '' : 's'}.` : 'Up to date — no new rides.')
    } catch (e) {
      setSyncMsg(e.message === 'not connected' ? 'Connect Strava first.' : `Sync failed: ${e.message}`)
    }
    setSyncing(false)
  }

  const totalSessions = plan.reduce((a, w) => a + w.sessions.filter(s => s.zone !== 'rest').length, 0)
  const doneSessions = Object.values(sessionState).filter(s => s?.completed).length

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'training', label: 'Training weeks' },
    { id: 'guide', label: 'Plan guide' },
    { id: 'zones', label: 'Power zones' },
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
          {tab === 'overview' && <Overview user={user} plan={plan} sessionState={sessionState} onToggle={toggleSession} onBail={bailSession} doneSessions={doneSessions} totalSessions={totalSessions} daysLeft={daysLeft}
            strava={{ configured: stravaConfigured, account: stravaAccount, syncing, syncMsg, onConnect: handleConnectStrava, onSync: handleSyncStrava }} />}
          {tab === 'calendar' && <CalendarView plan={plan} sessionState={sessionState} eventName={user.event_name} />}
          {tab === 'training' && <TrainingWeeks plan={plan} sessionState={sessionState} activities={activities} onToggle={toggleSession} onBail={bailSession} onRPE={setRPE} onNote={setNote} />}
          {tab === 'guide' && <PlanGuide plan={plan} user={user} />}
          {tab === 'zones' && <PowerZones user={user} onUpdateFTP={handleUpdateFTP} ftpHistory={ftpHistory} />}
{tab === 'adjustments' && <Adjustments user={user} adjustments={adjustments} plan={plan} onAdd={handleAddAdjustment} onDelete={handleDeleteAdjustment} onUpdateFTP={handleUpdateFTP} />}
        </>
      )}
    </div>
  )
}
