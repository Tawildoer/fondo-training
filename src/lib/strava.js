import { supabase } from './supabase'

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
export function matchActivityToDate(activities, date) {
  if (!date) return null
  const key = localKey(date)
  return activities.find(a => a.start_date && a.start_date.slice(0, 10) === key) || null
}
