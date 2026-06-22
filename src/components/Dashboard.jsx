import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { generatePlan, computeAdaptation, applyAdaptation } from '../lib/planGenerator'
import { getPlanStart, getCurrentWeekNum, getUnconfirmedSessions, computeStreak, localDateStr, nextEvent } from '../lib/schedule'
import { celebrate } from '../lib/celebrate'
import { parseLeadingMinutes, computeTrainingLoad } from '../lib/trainingLoad'
import { loadSessionState, upsertSessionState, loadAdjustments, addAdjustment, deleteAdjustment, updateUser, loadFtpHistory, addFtpEntry, getStravaAccount, loadActivities, loadPlannedWeeks, upsertPlannedWeek, deletePlannedWeek, loadEvents, addEvent, updateEvent, deleteEvent } from '../lib/supabase'
import { syncStrava, getStravaAuthUrl, stravaConfigured, getStravaAutoCompletions } from '../lib/strava'
import TrainingWeeks from './TrainingWeeks'
import Analytics from './Analytics'
import Adjustments from './Adjustments'
import Overview from './Overview'
import CalendarView from './CalendarView'
import PlanGuide from './PlanGuide'
import WeeklyPlanner from './WeeklyPlanner'
import { buildSession } from '../lib/weeklyPlanner'

// Reconstruct the app-wide plan shape from persisted weekly-planner weeks.
function buildPlanFromWeeks(weeks) {
  return [...(weeks || [])]
    .sort((a, b) => a.week_num - b.week_num)
    .map(w => {
      const sessions = w.sessions || []
      const mins = sessions.reduce((s, x) => s + (x.zone === 'rest' ? 0 : parseLeadingMinutes(x.desc)), 0)
      return {
        num: w.week_num,
        phase: 'weekly',
        phaseLabel: w.inputs?.phase || 'Planned week',
        label: w.inputs?.recovery ? 'Recovery week' : 'Planned week',
        hrs: Math.round((mins / 60) * 2) / 2,
        dateStr: new Date(w.week_start + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
        isRecovery: !!w.inputs?.recovery,
        sessions,
      }
    })
}

export default function Dashboard({ user, onLogout, onUpdateUser }) {
  const [tab, setTab] = useState('overview')
  const [plan, setPlan] = useState([])
  const [sessionState, setSessionState] = useState({}) // { 'w1_0': { completed, rpe, notes, zone } }
  const [adjustments, setAdjustments] = useState([])
  const [ftpHistory, setFtpHistory] = useState([])
  const [activities, setActivities] = useState([])
  const [stravaAccount, setStravaAccount] = useState(null)
  const [plannedWeeks, setPlannedWeeks] = useState([])
  const [events, setEvents] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const autoSyncedRef = useRef(false)

  // The fixed plan is retired — the guided weekly planner is the only mode now.
  const weeklyMode = true

  // Effective events: the events table, falling back to a legacy profile event
  // (so nothing regresses before the backfill/migration runs).
  const effectiveEvents = events.length
    ? events
    : (user?.event_date ? [{ id: 'legacy', name: user.event_name, date: user.event_date, event_type: user.event_type, distance_km: user.event_distance_km }] : [])
  const upcomingEvent = nextEvent(effectiveEvents)
  const daysLeft = upcomingEvent?._date ? Math.ceil((upcomingEvent._date - new Date()) / (1000 * 60 * 60 * 24)) : null

  // Plan source depends on mode: weekly mode reconstructs from persisted
  // bespoke weeks; fixed mode generates the template plan from the profile.
  useEffect(() => {
    setPlan(weeklyMode ? buildPlanFromWeeks(plannedWeeks) : generatePlan(user))
  }, [user, weeklyMode, plannedWeeks])

  // Backfill a fixed plan start date for users created before anchoring existed.
  useEffect(() => {
    if (user?.id && !user.plan_start_date) {
      const today = localDateStr(new Date())
      updateUser(user.id, { plan_start_date: today })
      onUpdateUser({ ...user, plan_start_date: today })
    }
  }, [user?.id, user?.plan_start_date])

  // Load persisted state from Supabase
  useEffect(() => {
    if (!user?.id) return
    Promise.all([
      loadSessionState(user.id),
      loadAdjustments(user.id),
      loadFtpHistory(user.id),
      getStravaAccount(user.id),
      loadActivities(user.id),
      loadPlannedWeeks(user.id),
      loadEvents(user.id),
    ]).then(([sessions, adjs, ftps, strava, acts, weeks, evs]) => {
      const stateMap = {}
      sessions.forEach(s => {
        const key = `w${s.week_num}_${s.session_idx}`
        stateMap[key] = { completed: s.completed, bailed: s.bailed, auto_completed: s.auto_completed, rpe: s.rpe, notes: s.notes, zone: null }
      })
      setSessionState(stateMap)
      setAdjustments(adjs)
      setFtpHistory(ftps)
      setStravaAccount(strava)
      setActivities(acts)
      setPlannedWeeks(weeks)
      setEvents(evs)
      setLoading(false)
    })
  }, [user?.id])

  // One-time backfill: move a legacy single event from the profile into the
  // events table so multi-event management has it.
  const eventBackfilledRef = useRef(false)
  useEffect(() => {
    if (loading || eventBackfilledRef.current) return
    if (events.length === 0 && user?.event_date) {
      eventBackfilledRef.current = true
      addEvent(user.id, { name: user.event_name || null, date: user.event_date, event_type: user.event_type || null, distance_km: user.event_distance_km || null })
        .then(ev => { if (ev) setEvents([ev]) })
    }
  }, [loading, events.length, user?.id, user?.event_date])

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
    // A manual complete also clears the "auto from Strava" flag; un-checking
    // keeps it sticky so the auto-completer won't re-tick it.
    setSessionState(prev => ({ ...prev, [key]: { ...prev[key], completed: newCompleted, bailed: newCompleted ? false : prev[key]?.bailed, auto_completed: newCompleted ? false : prev[key]?.auto_completed, zone } }))
    if (newCompleted) celebrate()
    await upsertSessionState(user.id, weekNum, idx, { completed: newCompleted, completed_at: now, ...(newCompleted ? { bailed: false, auto_completed: false } : {}) })
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
    onUpdateUser(updated) // the plan effect rebuilds for the active mode
  }

  async function handleSaveWeek(weekNumToSave, fields) {
    const saved = await upsertPlannedWeek(user.id, weekNumToSave, fields)
    if (saved) setPlannedWeeks(prev => [...prev.filter(w => w.week_num !== weekNumToSave), saved].sort((a, b) => a.week_num - b.week_num))
  }

  async function handleDeleteWeek(weekNumToDelete) {
    await deletePlannedWeek(user.id, weekNumToDelete)
    setPlannedWeeks(prev => prev.filter(w => w.week_num !== weekNumToDelete))
  }

  // Edit a single session of a planned week in place (zone and/or duration).
  async function handleEditSession(weekNumE, idx, patch) {
    const row = plannedWeeks.find(w => w.week_num === weekNumE)
    if (!row) return
    const cur = row.sessions?.[idx] || {}
    const zone = patch.zone ?? cur.zone
    const updated = zone === 'rest'
      ? buildSession(cur.day, 'rest', 0, user.ftp)
      : buildSession(cur.day, zone, patch.minutes ?? cur.durationMin ?? 60, user.ftp, cur.name === 'Long ride')
    const sessions = row.sessions.map((s, i) => (i === idx ? updated : s))
    // Reflect the edit immediately; reconcile with the server row when it lands.
    setPlannedWeeks(prev => prev.map(w => (w.week_num === weekNumE ? { ...w, sessions } : w)))
    const saved = await upsertPlannedWeek(user.id, weekNumE, { sessions })
    if (saved) setPlannedWeeks(prev => prev.map(w => (w.week_num === weekNumE ? saved : w)))
  }

  async function handleAddEvent(fields) {
    const ev = await addEvent(user.id, fields)
    if (ev) setEvents(prev => [...prev, ev].sort((a, b) => a.date.localeCompare(b.date)))
  }
  async function handleUpdateEvent(id, fields) {
    const ev = await updateEvent(id, fields)
    if (ev) setEvents(prev => prev.map(e => (e.id === id ? ev : e)).sort((a, b) => a.date.localeCompare(b.date)))
  }
  async function handleDeleteEvent(id) {
    await deleteEvent(id)
    setEvents(prev => prev.filter(e => e.id !== id))
  }

  async function handleSetMode(mode) {
    setTab('overview')
    await updateUser(user.id, { planning_mode: mode })
    onUpdateUser({ ...user, planning_mode: mode })
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

  // Adaptive layer — anchor the plan in real time, then adjust upcoming weeks
  // from the confirmed recent-week signals. All derived, no extra storage.
  const planStart = useMemo(() => getPlanStart(user), [user?.plan_start_date])
  const realCurrentWeek = useMemo(() => getCurrentWeekNum(planStart), [planStart])
  const currentWeek = useMemo(
    () => Math.min(plan.length || 1, realCurrentWeek),
    [realCurrentWeek, plan.length]
  )
  // Weekly mode carries its own (load-driven) adjustment in the planner, so the
  // fixed-plan adaptation engine is disabled there.
  const adaptation = useMemo(
    () => weeklyMode ? null : computeAdaptation(plan, sessionState, currentWeek),
    [plan, sessionState, currentWeek, weeklyMode]
  )
  const adjustedPlan = useMemo(
    () => weeklyMode ? plan : applyAdaptation(plan, adaptation, currentWeek),
    [plan, adaptation, currentWeek, weeklyMode]
  )
  const unconfirmed = useMemo(
    () => getUnconfirmedSessions(adjustedPlan, sessionState, planStart),
    [adjustedPlan, sessionState, planStart]
  )

  // Auto-complete past sessions that have a matching Strava ride. Self-
  // terminating: completed sessions are skipped, and `auto_completed` is sticky
  // so a session the user un-checks is never re-completed. Uses the base `plan`
  // (only future weeks differ in adjustedPlan; past sessions are identical).
  useEffect(() => {
    if (loading) return
    const todo = getStravaAutoCompletions(plan, sessionState, activities, planStart)
    if (!todo.length) return
    setSessionState(prev => {
      const next = { ...prev }
      todo.forEach(({ weekNum, idx, zone }) => {
        const key = `w${weekNum}_${idx}`
        next[key] = { ...next[key], completed: true, bailed: false, auto_completed: true, zone }
      })
      return next
    })
    todo.forEach(({ weekNum, idx, completedAt }) =>
      upsertSessionState(user.id, weekNum, idx, { completed: true, bailed: false, auto_completed: true, completed_at: completedAt })
    )
  }, [loading, plan, activities, planStart, sessionState, user.id])

  const streak = useMemo(
    () => computeStreak(plan, sessionState, planStart),
    [plan, sessionState, planStart]
  )

  // Load context for the weekly planner's brain: current fitness + the load of
  // the last 7 days, so it can ramp safely from what you've actually been doing.
  const loadCtx = useMemo(() => {
    const tl = computeTrainingLoad(plan, sessionState, activities, user, planStart)
    const recentWeeklyTss = tl.series.slice(-7).reduce((s, d) => s + d.load, 0)
    return { currentCtl: tl.current.ctl, currentTsb: tl.current.tsb, recentWeeklyTss: Math.round(recentWeeklyTss) }
  }, [plan, sessionState, activities, user, planStart])

  // The week you'd actually plan now (weekend → the upcoming week), kept in
  // sync with WeeklyPlanner's default so the CTA doesn't nag about a dead week.
  const planningWeekNum = realCurrentWeek + ([0, 6].includes(new Date().getDay()) ? 1 : 0)
  const currentWeekPlanned = useMemo(
    () => plannedWeeks.some(w => w.week_num === planningWeekNum),
    [plannedWeeks, planningWeekNum]
  )

  const totalSessions = adjustedPlan.reduce((a, w) => a + w.sessions.filter(s => s.zone !== 'rest').length, 0)
  const doneSessions = Object.values(sessionState).filter(s => s?.completed).length

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'plan-week', label: 'Plan week' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'training', label: 'Training weeks' },
    { id: 'analytics', label: 'Analytics' },
  ]

  // Sliding tab indicator — measures the active button and animates a single
  // pill to it, rather than snapping a background between buttons.
  const tabsRef = useRef(null)
  const [tabInd, setTabInd] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const [tabAnimate, setTabAnimate] = useState(false)
  useEffect(() => {
    const measure = () => {
      const el = tabsRef.current?.querySelector(`[data-tab="${tab}"]`)
      if (!el) return
      setTabInd({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
    }
    measure()
    // Enable the transition only after the first measurement so it doesn't
    // animate in from the corner on mount.
    const raf = requestAnimationFrame(() => setTabAnimate(true))
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure) }
  }, [tab, loading])

  return (
    <div className="app-shell">
      {/* Hero header */}
      <div className="hero">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="hero-title">{upcomingEvent ? `Next event: ${upcomingEvent.name || 'Event'}` : 'Training plan'}</h1>
          <p className="hero-sub">
            {user.name}{upcomingEvent?.distance_km ? ` · ${upcomingEvent.distance_km}km` : ''}{upcomingEvent?._date ? ` · ${upcomingEvent._date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
          </p>
          {streak?.current > 0 && (
            <span className="hero-streak"><span aria-hidden="true">🔥</span> {streak.current} session{streak.current === 1 ? '' : 's'} in a row</span>
          )}
        </div>
        <div className="hero-side">
          {daysLeft !== null && (
            <div className="hero-countdown">
              <div className="num">{daysLeft}</div>
              <div className="lbl">days left</div>
            </div>
          )}
          <button className="hero-btn" onClick={onLogout} title="Log out" style={{ gap: 6 }}>
            <i className="ti ti-logout" aria-hidden="true" /> <span style={{ fontSize: 13, fontWeight: 600 }}>Log out</span>
          </button>
        </div>
      </div>

      <div className="tabs" ref={tabsRef}>
        <span
          className={`tab-indicator ${tabAnimate ? 'tab-indicator--animated' : ''}`}
          style={{ transform: `translate(${tabInd.left}px, ${tabInd.top}px)`, width: tabInd.width, height: tabInd.height, opacity: tabInd.width ? 1 : 0 }}
          aria-hidden="true"
        />
        {TABS.map(t => (
          <button key={t.id} data-tab={t.id} className={`tab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
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
          {tab === 'overview' && <Overview user={user} plan={adjustedPlan} sessionState={sessionState} planStart={planStart} adaptation={adaptation} unconfirmed={unconfirmed} activities={activities} streak={streak} loadCtx={loadCtx} events={effectiveEvents} plannedWeeks={plannedWeeks} realCurrentWeek={realCurrentWeek} onToggle={toggleSession} onBail={bailSession} onRPE={setRPE} doneSessions={doneSessions} totalSessions={totalSessions} daysLeft={daysLeft}
            needsPlan={weeklyMode && !currentWeekPlanned} onPlanWeek={() => setTab('plan-week')}
            strava={{ configured: stravaConfigured, account: stravaAccount, syncing, syncMsg, onConnect: handleConnectStrava, onSync: handleSyncStrava }} />}
          {tab === 'plan-week' && weeklyMode && <WeeklyPlanner user={user} planStart={planStart} weekNum={realCurrentWeek} plannedWeeks={plannedWeeks} events={effectiveEvents} loadCtx={loadCtx} onSave={handleSaveWeek} onDelete={handleDeleteWeek} onGenerated={() => setTab('training')} />}
          {tab === 'calendar' && <CalendarView plan={adjustedPlan} sessionState={sessionState} planStart={planStart} eventName={upcomingEvent?.name} events={effectiveEvents} onAddEvent={handleAddEvent} onUpdateEvent={handleUpdateEvent} onDeleteEvent={handleDeleteEvent} />}
          {tab === 'training' && <TrainingWeeks plan={adjustedPlan} sessionState={sessionState} activities={activities} planStart={planStart} adaptation={adaptation} currentWeek={currentWeek} realCurrentWeek={realCurrentWeek} user={user} strava={{ configured: stravaConfigured, account: stravaAccount, syncing, syncMsg, onSync: handleSyncStrava }} onToggle={toggleSession} onBail={bailSession} onRPE={setRPE} onNote={setNote} onEditSession={handleEditSession} />}
          {tab === 'guide' && <PlanGuide plan={adjustedPlan} user={user} />}
          {tab === 'analytics' && <Analytics user={user} onUpdateFTP={handleUpdateFTP} ftpHistory={ftpHistory} plan={adjustedPlan} sessionState={sessionState} planStart={planStart} activities={activities} events={effectiveEvents} loadCtx={loadCtx} plannedWeeks={plannedWeeks} realCurrentWeek={realCurrentWeek} />}
{tab === 'adjustments' && <Adjustments user={user} adjustments={adjustments} plan={adjustedPlan} onAdd={handleAddAdjustment} onDelete={handleDeleteAdjustment} onUpdateFTP={handleUpdateFTP} />}
        </>
      )}
    </div>
  )
}
