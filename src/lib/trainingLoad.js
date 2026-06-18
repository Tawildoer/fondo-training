// ── Training load (PMC) ──────────────────────────────────────
// Performance Management Chart: fitness (CTL), fatigue (ATL), form (TSB).
// Per-day training load comes from the best source available:
//   1. Synced Strava rides → power-based TSS (NP/FTP), HR-based if no power.
//   2. Days you ticked a planned session but didn't sync a ride → an estimate
//      from the session's planned zone + duration, nudged by RPE.
// Real ride data always wins on days that have it.

import { getScheduledSessions, localDateStr, parseLocalDate } from './schedule'

// Intensity factor per zone (midpoint of the zone's % of FTP) for estimates.
const ZONE_IF = { z1: 0.45, z2: 0.65, z3: 0.83, z4: 0.98, z5: 1.13 }

const DAY_MS = 24 * 60 * 60 * 1000
const CTL_TC = 42 // fitness time constant (days)
const ATL_TC = 7  // fatigue time constant (days)

// Minutes from the *leading* duration of a description (its overall length).
export function parseLeadingMinutes(desc) {
  if (!desc) return 0
  const range = desc.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i)
  if (range) {
    const isHr = range[3][0].toLowerCase() === 'h'
    const avg = (+range[1] + +range[2]) / 2
    return isHr ? avg * 60 : avg
  }
  const single = desc.match(/^(\d+(?:\.\d+)?)\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i)
  if (single) {
    const isHr = single[2][0].toLowerCase() === 'h'
    return isHr ? +single[1] * 60 : +single[1]
  }
  return 0
}

// Real TSS for a synced ride. Power-based when watts + FTP are available,
// otherwise HR-based, otherwise a steady-endurance estimate from duration.
export function estActivityTSS(activity, ftp, maxHr) {
  const durH = (activity.moving_time_s || activity.elapsed_time_s || 0) / 3600
  if (durH <= 0) return 0
  const np = activity.weighted_avg_watts || activity.avg_watts
  if (np && ftp) {
    const IF = np / ftp
    return Math.round(durH * IF * IF * 100)
  }
  if (activity.avg_hr && maxHr) {
    // %max-HR → rough IF (threshold HR ≈ 91% of max).
    const IF = Math.min(1.15, Math.max(0.4, (activity.avg_hr / maxHr) / 0.91))
    return Math.round(durH * IF * IF * 100)
  }
  return Math.round(durH * 0.65 * 0.65 * 100)
}

// Estimated TSS for a completed planned session (the no-ride fallback).
export function estSessionLoad(session, state) {
  if (!session || session.zone === 'rest') return 0
  if (!state?.completed) return 0
  const minutes = parseLeadingMinutes(session.desc) || 45
  const IF = ZONE_IF[session.zone] || 0.65
  let tss = (minutes / 60) * IF * IF * 100
  if (state.rpe) tss *= 0.8 + (state.rpe - 3) * 0.1 // rpe1 ×0.6 … rpe5 ×1.2
  return Math.round(tss)
}

// Builds the daily CTL/ATL/TSB series, start → today.
// Returns { series, current, hasData, fromRides }.
export function computeTrainingLoad(plan, sessionState, activities, user, planStart, base = new Date()) {
  const ftp = user?.ftp
  const maxHr = user?.max_hr

  // 1. Real load from synced rides, bucketed by local day.
  const rideByDay = {}
  ;(activities || []).forEach(a => {
    if (!a.start_date) return
    const k = localDateStr(new Date(a.start_date))
    rideByDay[k] = (rideByDay[k] || 0) + estActivityTSS(a, ftp, maxHr)
  })

  // 2. Planned estimate for completed sessions (fallback per day).
  const scheduled = getScheduledSessions(plan, { base: planStart })
  const plannedByDay = {}
  let earliest = null
  scheduled.forEach(({ session, date, weekNum, idx }) => {
    if (!earliest || date < earliest) earliest = date
    const load = estSessionLoad(session, sessionState[`w${weekNum}_${idx}`])
    if (load > 0) plannedByDay[localDateStr(date)] = (plannedByDay[localDateStr(date)] || 0) + load
  })
  Object.keys(rideByDay).forEach(k => {
    const d = parseLocalDate(k)
    if (d && (!earliest || d < earliest)) earliest = d
  })

  const dayKeys = new Set([...Object.keys(rideByDay), ...Object.keys(plannedByDay)])
  if (dayKeys.size === 0) return { series: [], current: { ctl: 0, atl: 0, tsb: 0 }, hasData: false, fromRides: false }

  const today = new Date(base); today.setHours(0, 0, 0, 0)
  const start = new Date(Math.min(earliest ? earliest.getTime() : today.getTime(), today.getTime()))
  start.setHours(0, 0, 0, 0)

  const series = []
  let ctl = 0
  let atl = 0
  for (let t = start.getTime(); t <= today.getTime(); t += DAY_MS) {
    const k = localDateStr(new Date(t))
    // Real ride load wins on days that have it; else the planned estimate.
    const load = rideByDay[k] != null ? rideByDay[k] : (plannedByDay[k] || 0)
    ctl += (load - ctl) / CTL_TC
    atl += (load - atl) / ATL_TC
    series.push({ date: new Date(t), load, ctl, atl, tsb: ctl - atl })
  }

  const last = series[series.length - 1]
  return {
    series,
    current: { ctl: Math.round(last.ctl), atl: Math.round(last.atl), tsb: Math.round(last.tsb) },
    hasData: true,
    fromRides: Object.keys(rideByDay).length > 0,
  }
}
