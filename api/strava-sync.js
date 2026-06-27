// POST /api/strava-sync
// Pulls the caller's recent Strava rides + data streams and stores them.
import { getUserContext, stravaTokenRequest } from './_lib.js'

export const config = { maxDuration: 60 }

const MAX_RIDES_PER_SYNC = 20
const STREAM_KEYS = 'time,watts,heartrate,cadence,altitude'

async function ensureToken(supabase, userId) {
  const { data: acct } = await supabase
    .from('strava_accounts').select('*').eq('user_id', userId).single()
  if (!acct) return { error: 'not connected' }

  const now = Math.floor(Date.now() / 1000)
  if (acct.expires_at - 60 > now) return { acct }

  // Token expired — refresh it.
  const r = await stravaTokenRequest({ grant_type: 'refresh_token', refresh_token: acct.refresh_token })
  if (!r.ok) return { error: 'token refresh failed' }
  const d = await r.json()
  await supabase.from('strava_accounts').update({
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: d.expires_at,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId)
  return { acct: { ...acct, access_token: d.access_token, expires_at: d.expires_at } }
}

async function fetchStreams(activityId, token) {
  try {
    const r = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${STREAM_KEYS}&key_by_type=true&resolution=medium`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) return null
    const s = await r.json()
    return {
      time: s.time?.data || null,
      watts: s.watts?.data || null,
      heartrate: s.heartrate?.data || null,
      cadence: s.cadence?.data || null,
      altitude: s.altitude?.data || null,
    }
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const ctx = await getUserContext(req)
  if (ctx.error) return res.status(401).json({ error: ctx.error })

  const { acct, error } = await ensureToken(ctx.supabase, ctx.userId)
  if (error) return res.status(400).json({ error })
  const token = acct.access_token

  // List recent activities (with a small overlap window since last sync).
  const params = new URLSearchParams({ per_page: '30', page: '1' })
  if (acct.last_synced_at) {
    const after = Math.floor(new Date(acct.last_synced_at).getTime() / 1000) - 86400
    params.set('after', String(after))
  }
  const listRes = await fetch(`https://www.strava.com/api/v3/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!listRes.ok) {
    const detail = await listRes.text()
    return res.status(502).json({ error: 'strava list failed', detail })
  }
  const list = await listRes.json()
  // Import all endurance disciplines (bike, run, swim) — multi-sport athletes
  // train across them and each contributes to training load.
  const trainable = list
    .filter(a => /ride|run|swim/i.test(a.sport_type || a.type || ''))
    .slice(0, MAX_RIDES_PER_SYNC)

  let imported = 0
  for (const a of trainable) {
    const streams = await fetchStreams(a.id, token)
    const { error: upErr } = await ctx.supabase.from('activities').upsert({
      user_id: ctx.userId,
      strava_id: a.id,
      name: a.name,
      sport_type: a.sport_type || a.type,
      start_date: a.start_date_local || a.start_date, // local wall-clock, for day matching
      distance_m: a.distance ?? null,
      moving_time_s: a.moving_time ?? null,
      elapsed_time_s: a.elapsed_time ?? null,
      total_elevation_m: a.total_elevation_gain ?? null,
      avg_watts: a.average_watts ?? null,
      weighted_avg_watts: a.weighted_average_watts ?? null,
      max_watts: a.max_watts ?? null,
      avg_hr: a.average_heartrate ?? null,
      max_hr: a.max_heartrate ?? null,
      avg_cadence: a.average_cadence ?? null,
      kilojoules: a.kilojoules ?? null,
      streams,
    }, { onConflict: 'user_id,strava_id' })
    if (!upErr) imported++
  }

  await ctx.supabase.from('strava_accounts')
    .update({ last_synced_at: new Date().toISOString() }).eq('user_id', ctx.userId)

  return res.status(200).json({ ok: true, imported, scanned: list.length })
}
