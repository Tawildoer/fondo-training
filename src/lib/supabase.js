import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── Auth ─────────────────────────────────────────────────────

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  })
  if (error) throw error
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

// ── Users ────────────────────────────────────────────────────

export async function getUserByAuthId(authId) {
  // maybeSingle: a missing profile (fresh sign-up) is expected, not an error.
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authId)
    .maybeSingle()
  return data
}

export async function createUser(profile) {
  const { data, error } = await supabase
    .from('users')
    .insert([profile])
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateUser(userId, updates) {
  const { error } = await supabase
    .from('users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', userId)
  return !error
}

// ── FTP history ──────────────────────────────────────────────

export async function loadFtpHistory(userId) {
  const { data } = await supabase
    .from('ftp_history')
    .select('*')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: true })
  return data || []
}

export async function addFtpEntry(userId, ftp) {
  const { data, error } = await supabase
    .from('ftp_history')
    .insert([{ user_id: userId, ftp }])
    .select()
    .single()
  if (error) return null
  return data
}

// ── Strava ───────────────────────────────────────────────────

export async function getStravaAccount(userId) {
  // maybeSingle: most users simply haven't connected Strava.
  const { data } = await supabase
    .from('strava_accounts')
    .select('athlete_id, last_synced_at')
    .eq('user_id', userId)
    .maybeSingle()
  return data
}

export async function loadActivities(userId) {
  const { data } = await supabase
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
  return data || []
}

// ── Session state ────────────────────────────────────────────

export async function loadSessionState(userId) {
  const { data } = await supabase
    .from('session_state')
    .select('*')
    .eq('user_id', userId)
  return data || []
}

export async function upsertSessionState(userId, weekNum, sessionIdx, updates) {
  const { error } = await supabase
    .from('session_state')
    .upsert({
      user_id: userId,
      week_num: weekNum,
      session_idx: sessionIdx,
      updated_at: new Date().toISOString(),
      ...updates,
    }, { onConflict: 'user_id,week_num,session_idx' })
  return !error
}

// ── Planned weeks (guided weekly planner) ────────────────────

export async function loadPlannedWeeks(userId) {
  const { data } = await supabase
    .from('planned_weeks')
    .select('*')
    .eq('user_id', userId)
    .order('week_num', { ascending: true })
  return data || []
}

export async function upsertPlannedWeek(userId, weekNum, fields) {
  const { data, error } = await supabase
    .from('planned_weeks')
    .upsert({
      user_id: userId,
      week_num: weekNum,
      updated_at: new Date().toISOString(),
      ...fields,
    }, { onConflict: 'user_id,week_num' })
    .select()
    .single()
  return error ? null : data
}

export async function deletePlannedWeek(userId, weekNum) {
  const { error } = await supabase
    .from('planned_weeks')
    .delete()
    .eq('user_id', userId)
    .eq('week_num', weekNum)
  return !error
}

// ── Events (goal events) ─────────────────────────────────────

export async function loadEvents(userId) {
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })
  return data || []
}

export async function addEvent(userId, fields) {
  const { data, error } = await supabase
    .from('events')
    .insert({ user_id: userId, ...fields })
    .select()
    .single()
  return error ? null : data
}

export async function updateEvent(id, fields) {
  const { data, error } = await supabase
    .from('events')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  return error ? null : data
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  return !error
}

// ── Adjustments ──────────────────────────────────────────────

export async function loadAdjustments(userId) {
  const { data } = await supabase
    .from('adjustments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return data || []
}

export async function addAdjustment(userId, adj) {
  const { error } = await supabase
    .from('adjustments')
    .insert([{ user_id: userId, ...adj }])
  return !error
}

export async function deleteAdjustment(id) {
  const { error } = await supabase
    .from('adjustments')
    .delete()
    .eq('id', id)
  return !error
}
