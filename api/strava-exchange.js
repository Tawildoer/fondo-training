// POST /api/strava-exchange  { code, scope }
// Exchanges a Strava OAuth code for tokens and stores them for the caller.
import { getUserContext, stravaTokenRequest } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const { code, scope } = req.body || {}
  if (!code) return res.status(400).json({ error: 'missing code' })

  const ctx = await getUserContext(req)
  if (ctx.error) return res.status(401).json({ error: ctx.error })

  const tokenRes = await stravaTokenRequest({ code, grant_type: 'authorization_code' })
  if (!tokenRes.ok) {
    const detail = await tokenRes.text()
    return res.status(400).json({ error: 'strava token exchange failed', detail })
  }
  const data = await tokenRes.json()

  const { error } = await ctx.supabase.from('strava_accounts').upsert({
    user_id: ctx.userId,
    athlete_id: data.athlete?.id ?? null,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    scope: scope || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (error) return res.status(500).json({ error: 'store failed', detail: error.message })

  return res.status(200).json({ ok: true, athlete_id: data.athlete?.id ?? null })
}
