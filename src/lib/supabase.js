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
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('auth_id', authId)
    .single()
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
  const { data } = await supabase
    .from('strava_accounts')
    .select('athlete_id, last_synced_at')
    .eq('user_id', userId)
    .single()
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
