// ── Guided weekly planner (load-driven) ──────────────────────
// The "brain" for the flexibility-centric mode. Each week:
//   1. computeWeekTarget() picks a target weekly load (TSS) from recent
//      fitness (CTL), your goal (maintain/build), event proximity (volume
//      ramps up as it nears, then tapers), freshness and a busy-week flag.
//   2. draftWeek() lays sessions onto the days you're available, sized to
//      your time budget and scaled toward the target, then you edit + lock.
// Output sessions match the app-wide plan shape so every downstream feature
// (calendar, streak, training load, Strava auto-complete) just works.

import { getZoneLabel } from './planGenerator'

const ZONE_IF = { z1: 0.45, z2: 0.65, z3: 0.83, z4: 0.98, z5: 1.13 }
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// TSS for a zone held for `minutes`. Mirrors trainingLoad.js's model.
export function tssFor(zone, minutes) {
  const IF = ZONE_IF[zone] || 0.65
  return Math.round((minutes / 60) * IF * IF * 100)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ── 1. Weekly load target ────────────────────────────────────
// `ctx` = { currentCtl, recentWeeklyTss, weeksToEvent (null if no event),
//           weekNum, availableMinutes }
export function computeWeekTarget(inputs, ctx = {}) {
  const { goal = 'build', freshness = 3, focus = 'none', busy = false } = inputs || {}
  const { currentCtl = 0, currentTsb = null, recentWeeklyTss = 0, weeklyHoursStart = 0, weeksToEvent = null, weekNum = 1, availableMinutes = 0 } = ctx

  // Baseline = what you've been doing (best signal), else maintain current
  // fitness (CTL≈mean daily TSS, so a maintaining week ≈ CTL×7), else your
  // stated starting volume, else a rough estimate from time made available.
  let baseline = recentWeeklyTss > 0 ? recentWeeklyTss
    : currentCtl > 0 ? currentCtl * 7
    : weeklyHoursStart > 0 ? tssFor('z2', weeklyHoursStart * 60)
    : tssFor('z2', availableMinutes) || 250

  // A recovery week resets the block: when you ask for one, on a scheduled
  // 4-week cadence, or when fatigue is deep (form well into the red).
  const deeplyFatigued = currentTsb != null && currentTsb <= -25
  const isRecovery = focus === 'recovery' || (weekNum > 0 && weekNum % 4 === 0) || deeplyFatigued

  // Macro factor: event periodization wins when an event is set, otherwise the
  // maintain/build goal drives it.
  let macro
  let phase
  if (weeksToEvent != null) {
    if (weeksToEvent <= 0) { macro = 0.5; phase = 'Race week' }
    else if (weeksToEvent === 1) { macro = 0.6; phase = 'Taper' }
    else if (weeksToEvent === 2) { macro = 0.8; phase = 'Taper' }
    else if (weeksToEvent <= 8) { macro = 1.08; phase = 'Peak build' } // volume ramps up
    else { macro = goal === 'build' ? 1.05 : 1.0; phase = 'Base build' }
  } else {
    macro = goal === 'build' ? 1.06 : 1.0
    phase = goal === 'build' ? 'Build' : 'Maintain'
  }

  const freshnessFactor = [0.85, 0.85, 0.92, 1.0, 1.05, 1.1][clamp(freshness, 1, 5)]
  const busyFactor = busy ? 0.7 : 1

  let factor = macro * freshnessFactor * busyFactor
  if (isRecovery) { factor = 0.55 * busyFactor; phase = 'Recovery' }

  let target = baseline * factor
  // Safety ramp cap: don't jump volume more than ~12% week-on-week (recovery /
  // taper are allowed to drop below the floor).
  if (!isRecovery && weeksToEvent == null || (weeksToEvent != null && weeksToEvent > 2)) {
    target = clamp(target, baseline * 0.5, baseline * 1.12)
  }

  return {
    targetTss: Math.round(target),
    targetHours: hoursForTss(target),
    isRecovery,
    phase,
    hardDays: isRecovery ? 0 : hardDaysFor(focus, weeksToEvent, inputs),
    note: buildNote({ phase, goal, weeksToEvent, isRecovery, busy, deeplyFatigued }),
  }
}

// Rough TSS→hours so we can suggest a weekly volume. Assumes a typical
// endurance-weighted week (~0.72 IF blended → ~52 TSS/hr).
export function hoursForTss(tss) {
  return Math.max(0.5, Math.round((tss / 52) * 2) / 2)
}

// Rough projection of where this week's load leaves your fitness (CTL), so the
// planner can show "CTL 48 → 50" — leaning into the analytics ethos.
export function projectCtl(currentCtl, weeklyTss) {
  const daily = (weeklyTss || 0) / 7
  let ctl = currentCtl || 0
  for (let i = 0; i < 7; i++) ctl += (daily - ctl) / 42
  return Math.round(ctl)
}

function hardDaysFor(focus, weeksToEvent, inputs) {
  const avail = countAvailable(inputs)
  let n = 2
  if (focus === 'endurance') n = 1
  if (focus === 'threshold' || focus === 'climbing') n = 2
  if (weeksToEvent != null && weeksToEvent >= 3 && weeksToEvent <= 8) n = 3 // peak
  return clamp(n, 0, Math.max(0, avail - 1))
}

function countAvailable(inputs) {
  const days = inputs?.days || {}
  return DAY_NAMES.filter(d => (days[d] || 0) > 0).length
}

function buildNote({ phase, goal, weeksToEvent, isRecovery, busy, deeplyFatigued }) {
  if (deeplyFatigued) return 'Recovery week — your form is well into the red, so load is pulled back to let you absorb and rebound.'
  if (isRecovery) return 'Recovery week — load is intentionally pulled back so you absorb the last block.'
  if (weeksToEvent != null && weeksToEvent <= 2) return `Tapering — ${weeksToEvent} week${weeksToEvent === 1 ? '' : 's'} out. Volume drops, legs stay sharp.`
  if (weeksToEvent != null && weeksToEvent <= 8) return 'Peak build — volume ramps up as your event approaches.'
  if (busy) return 'Busy week — volume trimmed to protect recovery and consistency.'
  return goal === 'build' ? 'Building fitness — a small progressive overload on recent load.' : 'Maintaining fitness — holding your current load steady.'
}

// ── 2. Draft the week ────────────────────────────────────────
const restDay = day => ({ day, name: 'Rest', zone: 'rest', desc: 'Full rest. Sleep, hydrate, eat well.', durationMin: 0 })

// Build a single session (used by the draft and by the inline editor).
export function buildSession(day, zone, minutes, ftp, isLong = false) {
  if (zone === 'rest') return restDay(day)
  const meta = ZONE_META[zone] || ZONE_META.z2
  const min = clamp(Math.round(minutes / 5) * 5, 10, meta.max)
  return {
    day,
    zone,
    name: isLong && zone === 'z2' ? 'Long ride' : meta.name,
    desc: describe(zone, min, ftp, isLong),
    durationMin: min,
  }
}

export const ZONE_OPTIONS = [
  { zone: 'z1', label: 'Z1 · Recovery' },
  { zone: 'z2', label: 'Z2 · Endurance' },
  { zone: 'z3', label: 'Z3 · Sweet spot' },
  { zone: 'z4', label: 'Z4 · Threshold' },
  { zone: 'z5', label: 'Z5 · VO₂' },
  { zone: 'rest', label: 'Rest' },
]

const ZONE_META = {
  z1: { name: 'Recovery spin', min: 30, max: 60 },
  z2: { name: 'Endurance', min: 40, max: 300 },
  z3: { name: 'Sweet spot', min: 45, max: 120 },
  z4: { name: 'Threshold intervals', min: 40, max: 90 },
  z5: { name: 'VO₂ intervals', min: 35, max: 75 },
}

function fmtDur(min) {
  if (min >= 90) return `${(Math.round(min / 30) * 30) / 60} hr`
  return `${Math.round(min / 5) * 5} min`
}

function describe(zone, min, ftp, isLong) {
  const dur = fmtDur(min)
  const zl = ftp ? getZoneLabel(zone.toUpperCase(), ftp) : zone.toUpperCase()
  switch (zone) {
    case 'z1': return `${dur} very easy. Legs only, no intensity.`
    case 'z2': return isLong
      ? `${dur} steady endurance at ${zl}. Fuel every 30 min — long-ride practice.`
      : `${dur} steady at ${zl}. Controlled aerobic effort, no drifting up.`
    case 'z3': return `${dur} with sweet-spot blocks at ${zl}. Smooth, sustained power.`
    case 'z4': return `${dur} of threshold work at ${zl}. The key quality session — full recoveries between efforts.`
    case 'z5': return `${dur} with VO₂ intervals at ${zl}. Short, hard, full recoveries. Sharpening top end.`
    default: return `${dur}.`
  }
}

// Pick which available days carry the hard sessions: prefer longer days, keep
// them spaced apart (no back-to-back), and avoid the long-ride day.
function pickHardDays(available, longDay, hardDays) {
  const candidates = available
    .filter(d => d.day !== longDay && d.minutes >= 40)
    .sort((a, b) => b.minutes - a.minutes)
  const chosen = []
  for (const c of candidates) {
    if (chosen.length >= hardDays) break
    const idx = DAY_NAMES.indexOf(c.day)
    const adjacent = chosen.some(ch => Math.abs(DAY_NAMES.indexOf(ch) - idx) === 1)
    if (!adjacent) chosen.push(c.day)
  }
  // If spacing was too strict to fill the quota, relax it.
  for (const c of candidates) {
    if (chosen.length >= hardDays) break
    if (!chosen.includes(c.day)) chosen.push(c.day)
  }
  return chosen
}

export function draftWeek(target, inputs, ftp) {
  const days = inputs?.days || {}
  const focus = inputs?.focus || 'none'
  const available = DAY_NAMES
    .map(day => ({ day, minutes: days[day] || 0 }))
    .filter(d => d.minutes > 0)

  if (!available.length) return DAY_NAMES.map(restDay)

  const longDay = available.reduce((a, b) => (b.minutes > a.minutes ? b : a)).day
  const hardSet = new Set(target.isRecovery ? [] : pickHardDays(available, longDay, target.hardDays))

  // Assign a zone to each available day.
  const hardZoneFor = (i) => {
    if (focus === 'climbing') return 'z4'
    if (focus === 'threshold') return i === 0 ? 'z4' : 'z3'
    if (focus === 'endurance') return 'z3'
    return i === 0 ? 'z4' : 'z3' // balanced: one threshold, one sweet-spot
  }
  let hardSeen = 0
  const zoneByDay = {}
  available.forEach(({ day, minutes }) => {
    if (target.isRecovery) zoneByDay[day] = minutes <= 45 ? 'z1' : 'z2'
    else if (day === longDay) zoneByDay[day] = focus === 'endurance' ? 'z3' : 'z2'
    else if (hardSet.has(day)) zoneByDay[day] = hardZoneFor(hardSeen++)
    else zoneByDay[day] = minutes <= 40 ? 'z1' : 'z2'
  })

  // Scale durations toward the target: each day's ceiling is min(budget, zone
  // max); ratio scales them uniformly so volume tracks the target but never
  // exceeds the time you actually have (flexibility wins).
  const ceil = ({ day, minutes }) => Math.min(minutes, ZONE_META[zoneByDay[day]].max)
  const maxTss = available.reduce((s, d) => s + tssFor(zoneByDay[d.day], ceil(d)), 0) || 1
  const ratio = clamp(target.targetTss / maxTss, 0.4, 1)

  const byDay = {}
  available.forEach(d => {
    const zone = zoneByDay[d.day]
    const meta = ZONE_META[zone]
    const minutes = clamp(Math.round(ceil(d) * ratio / 5) * 5, Math.min(meta.min, d.minutes), ceil(d))
    byDay[d.day] = buildSession(d.day, zone, minutes, ftp, d.day === longDay)
  })

  return DAY_NAMES.map(day => byDay[day] || restDay(day))
}

// Total prescribed TSS of a drafted/edited session list (for the "why" panel).
export function weekTss(sessions) {
  return (sessions || []).reduce((s, x) => {
    if (!x || x.zone === 'rest') return s
    const minutes = x.durationMin != null ? x.durationMin
      : (() => { const m = x.desc?.match(/^(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours|min|mins|minutes)/i); return m ? (m[2][0].toLowerCase() === 'h' ? +m[1] * 60 : +m[1]) : 0 })()
    return s + tssFor(x.zone, minutes)
  }, 0)
}
