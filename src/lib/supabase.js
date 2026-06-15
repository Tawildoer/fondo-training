import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── Invite codes ────────────────────────────────────────────

export async function validateInviteCode(code) {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .eq('code', code.toUpperCase().trim())
    .single()
  if (error || !data) return { valid: false }
  return { valid: true, code: data }
}

export async function claimInviteCode(code, userId) {
  const { error } = await supabase
    .from('invite_codes')
    .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
    .eq('code', code)
  return !error
}

// ── Users ───────────────────────────────────────────────────

export async function getUserByCode(code) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('invite_code', code.toUpperCase().trim())
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

// ── Session state ───────────────────────────────────────────

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

// ── Adjustments ─────────────────────────────────────────────

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
