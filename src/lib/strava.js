import { supabase } from './supabase'
import { getScheduledSessions } from './schedule'
import { activitySport } from './trainingLoad'
import { sessionSport } from './sports'

const CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID

// Redirect the browser to Strava's consent screen.
export function getStravaAuthUrl() {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: window.location.origin,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
  })
  return `https://www.strava.com/oauth/authorize?${params}`
}

export const stravaConfigured = !!CLIENT_ID

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

async function postJSON(path, body) {
  const r = await fetch(path, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body || {}) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || data.detail || `${path} failed`)
  return data
}

export function exchangeStravaCode(code, scope) {
  return postJSON('/api/strava-exchange', { code, scope })
}

export function syncStrava() {
  return postJSON('/api/strava-sync', {})
}

// Local YYYY-MM-DD (not UTC — avoids a timezone off-by-one when matching).
function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Find the activity that falls on the same calendar day as a session date.
// When `sport` is given (and isn't a compound/strength session), only an
// activity of that discipline matches — so a run session pairs with a Run, not
// a Ride you also did that day. `brick` matches any endurance activity.
export function matchActivityToDate(activities, date, sport = null) {
  if (!date) return null
  const key = localKey(date)
  const sameDay = (activities || []).filter(a => a.start_date && a.start_date.slice(0, 10) === key)
  if (!sameDay.length) return null
  if (sport && sport !== 'brick' && sport !== 'multi') {
    return sameDay.find(a => activitySport(a) === sport) || null
  }
  return sameDay[0] // compound days (brick / two-a-day) match any activity that day
}

// Non-rest sessions on or before today that have a matching Strava ride and
// haven't been completed, bailed, or auto-completed before. Each entry is a
// session to mark complete from the ride, with the ride's timestamp.
// `auto_completed` is sticky: once we've auto-acted on a session we never do
// it again, so a user un-checking it stays un-checked.
export function getStravaAutoCompletions(plan, sessionState, activities, planStart, now = new Date()) {
  if (!activities?.length) return []
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const out = []
  getScheduledSessions(plan, { base: planStart }).forEach(({ session, date, weekNum, idx }) => {
    if (date.getTime() > today.getTime()) return // can't have trained a future day
    if (session.zone === 'strength') return // no Strava activity maps to a gym session
    const st = sessionState[`w${weekNum}_${idx}`] || {}
    if (st.completed || st.bailed || st.auto_completed) return
    const act = matchActivityToDate(activities, date, sessionSport(session))
    if (act) out.push({ weekNum, idx, zone: session.zone, completedAt: act.start_date })
  })
  return out
}
