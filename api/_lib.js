// Shared helpers for the Strava serverless functions.
// (Files prefixed with _ are not turned into routes by Vercel.)
import { createClient } from '@supabase/supabase-js'

function getBearer(req) {
  const h = req.headers.authorization || req.headers.Authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

// Verify the caller's Supabase JWT and resolve their profile (users.id).
// The returned client carries the user's token, so all queries run under RLS.
export async function getUserContext(req) {
  const token = getBearer(req)
  if (!token) return { error: 'missing token' }

  const url = process.env.VITE_SUPABASE_URL
  const anon = process.env.VITE_SUPABASE_ANON_KEY
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { error: 'invalid token' }

  const { data: profile } = await supabase
    .from('users')
    .select('id')
    .eq('auth_id', user.id)
    .single()
  if (!profile) return { error: 'no profile' }

  return { supabase, userId: profile.id, authUser: user }
}

export const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'

export async function stravaTokenRequest(body) {
  const r = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...body,
    }),
  })
  return r
}
