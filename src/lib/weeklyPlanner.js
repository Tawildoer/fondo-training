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
import { nextEvent, prevEvent, parseLocalDate, localDateStr } from './schedule'

const ZONE_IF = { z1: 0.45, z2: 0.65, z3: 0.83, z4: 0.98, z5: 1.13 }
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// TSS for a zone held for `minutes`. Mirrors trainingLoad.js's model.
export function tssFor(zone, minutes) {
  const IF = ZONE_IF[zone] || 0.65
  return Math.round((minutes / 60) * IF * IF * 100)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Estimated TSS of doing the event itself (a big one-off stimulus), from its
// type + distance. Used so the projection bumps up on the event, not just dips.
const EVENT_SPEED = { road_race: 38, criterium: 40, time_trial: 40, gran_fondo: 29, sportive: 28, other: 30 } // km/h
const EVENT_IF = { road_race: 0.85, criterium: 0.88, time_trial: 0.92, gran_fondo: 0.78, sportive: 0.76, other: 0.78 }
export function estimateEventTss(event) {
  if (!event) return 0
  const type = event.event_type || 'other'
  const IF = EVENT_IF[type] || 0.78
  let hours = event.distance_km ? event.distance_km / (EVENT_SPEED[type] || 30) : null
  if (!hours) hours = ['criterium', 'time_trial'].includes(type) ? 1 : 3 // sensible default
  hours = clamp(hours, 0.5, 8)
  return Math.round(hours * IF * IF * 100)
}

// ── 1. Weekly load target ────────────────────────────────────
// Self-contained weekly volume model — works entirely from the athlete's
// profile and real data, with no dependency on the (now-retired) fixed plan.
// `ctx` = { currentTsb, recentWeeklyTss, weeklyHoursStart, daysPerWeek,
//           weeksToEvent (null if no event), weekNum }
const TSS_PER_HOUR = 52 // endurance-weighted blended week

export function computeWeekTarget(inputs, ctx = {}) {
  const { goal = 'build', freshness = 3, focus = 'none', busy = false } = inputs || {}
  const { currentTsb = null, recentWeeklyTss = 0, weeklyHoursStart = 0, daysPerWeek = 5, weeksToEvent = null, weeksSinceEvent = null, weekNum = 1 } = ctx

  // Where you start and a sustainable ceiling (classic ~1.8× start, capped by
  // how many days you ride). Pure sports-science heuristics on your profile.
  const startHours = weeklyHoursStart > 0 ? weeklyHoursStart : 6
  const maxHours = Math.min(startHours * 1.8, daysPerWeek * 3)
  const recentHours = recentWeeklyTss > 0 ? recentWeeklyTss / TSS_PER_HOUR : 0

  // Progressive build ramp from your starting volume toward the ceiling,
  // reaching it ~8 weeks in. Adapts upward to real load so it never undershoots
  // a fitness level you've clearly already got.
  const progress = clamp((weekNum - 1) / 8, 0, 1)
  const rampHours = startHours + (maxHours - startHours) * progress

  let phase
  let baseHours
  if (goal === 'maintain') {
    baseHours = Math.max(startHours, recentHours)
    phase = 'Maintain'
  } else {
    baseHours = Math.max(rampHours, recentHours)
    phase = 'Build'
  }

  // Event periodization overlay: push volume in the peak window, taper in
  // (softer taper than before so fitness doesn't fall off a cliff).
  let eventFactor = 1
  if (weeksToEvent != null) {
    if (weeksToEvent <= 0) { eventFactor = 0.55; phase = 'Race week' }
    else if (weeksToEvent === 1) { eventFactor = 0.7; phase = 'Taper' }
    else if (weeksToEvent === 2) { eventFactor = 0.85; phase = 'Taper' }
    else if (weeksToEvent <= 8) { eventFactor = 1.05; phase = 'Peak build' }
    else phase = 'Base build'
  }

  // Post-event re-entry: the week after a race is a recovery/transition week,
  // then volume rebuilds gradually over a couple of weeks rather than snapping
  // straight back to full build.
  let reentryFactor = 1
  if (weeksSinceEvent === 2) reentryFactor = 0.8
  else if (weeksSinceEvent === 3) reentryFactor = 0.9

  // Recovery week + subjective modifiers.
  const deeplyFatigued = currentTsb != null && currentTsb <= -25
  const postEventRecovery = weeksSinceEvent === 1
  const isRecovery = focus === 'recovery' || deeplyFatigued || postEventRecovery || (weekNum > 0 && weekNum % 4 === 0)
  const freshnessFactor = [0.85, 0.85, 0.92, 1.0, 1.05, 1.1][clamp(freshness, 1, 5)]
  const busyFactor = busy ? 0.7 : 1

  // Take the more conservative of the event taper and the post-event re-entry
  // so neither over-rides the other when events are close together.
  let factor = Math.min(eventFactor, reentryFactor) * freshnessFactor * busyFactor
  if (reentryFactor < 1 && eventFactor >= 1) phase = 'Rebuild'
  if (isRecovery) { factor = 0.6 * busyFactor; phase = postEventRecovery ? 'Post-race recovery' : 'Recovery' }

  let targetHours = baseHours * factor
  targetHours = clamp(targetHours, startHours * (isRecovery ? 0.4 : 0.5), maxHours * 1.05)
  targetHours = Math.round(targetHours * 2) / 2

  return {
    targetHours,
    targetTss: Math.round(targetHours * TSS_PER_HOUR),
    isRecovery,
    phase,
    hardDays: isRecovery ? 0 : hardDaysFor(focus, weeksToEvent, inputs),
    note: buildNote({ phase, goal, weeksToEvent, weeksSinceEvent, isRecovery, busy, deeplyFatigued }),
  }
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
  return DAY_NAMES.filter(d => days[d]).length
}

function buildNote({ goal, weeksToEvent, weeksSinceEvent, isRecovery, busy, deeplyFatigued }) {
  if (deeplyFatigued) return 'Recovery week — your form is well into the red, so load is pulled back to let you absorb and rebound.'
  if (weeksSinceEvent === 1) return 'Post-race recovery — an easy week to absorb your event before rebuilding.'
  if (isRecovery) return 'Recovery week — load is intentionally pulled back so you absorb the last block.'
  if (weeksToEvent != null && weeksToEvent <= 2) return `Tapering — ${weeksToEvent} week${weeksToEvent === 1 ? '' : 's'} out. Volume drops, legs stay sharp.`
  if (weeksSinceEvent === 2 || weeksSinceEvent === 3) return 'Rebuilding after your event — easing volume back up over a couple of weeks.'
  if (weeksToEvent != null && weeksToEvent <= 8) return 'Peak build — volume ramps up as your event approaches.'
  if (busy) return 'Busy week — volume trimmed to protect recovery and consistency.'
  return goal === 'build' ? 'Building fitness — volume steps up progressively each week toward a sustainable ceiling.' : 'Maintaining fitness — holding your current volume steady.'
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

// Per-day length tiers → minutes. Coarse up front; fine-tune in the draft.
export const TIER_MIN = { S: 45, M: 90, L: 150 }
export const TIER_LABEL = { S: 'Short', M: 'Med', L: 'Long' }

// Quality-day zone: a long quality day is tempo/sweet-spot (z3); shorter
// quality days are threshold (z4), with sweet-spot variety when several stack.
function hardZone(i, focus, length) {
  if (length === 'L') return 'z3'
  if (focus === 'climbing' || focus === 'threshold') return 'z4'
  return i % 2 === 0 ? 'z4' : 'z3'
}

// Lay the week out directly from your per-day choices: each on-day carries a
// length (S/M/L) and a type (easy/hard). Off-days are rest. A recovery week
// forces everything easy.
export function draftWeek(target, inputs, ftp) {
  const days = inputs?.days || {}
  const focus = inputs?.focus || 'none'
  const onDays = DAY_NAMES.filter(d => days[d])
  if (!onDays.length) return DAY_NAMES.map(restDay)

  // Long ride = the longest easy day.
  const longEasy = onDays
    .filter(d => (days[d].type || 'easy') === 'easy')
    .sort((a, b) => TIER_MIN[days[b].length] - TIER_MIN[days[a].length])[0]

  let hardSeen = 0
  const byDay = {}
  onDays.forEach(day => {
    const { length = 'M', type = 'easy' } = days[day]
    const minutes = TIER_MIN[length] || 90
    let zone
    if (target.isRecovery) zone = minutes <= 45 ? 'z1' : 'z2'
    else if (type === 'hard') zone = hardZone(hardSeen++, focus, length)
    else zone = minutes <= 45 ? 'z1' : 'z2'
    byDay[day] = buildSession(day, zone, minutes, ftp, day === longEasy && zone === 'z2')
  })

  return DAY_NAMES.map(day => byDay[day] || restDay(day))
}

// ── Forward projection ───────────────────────────────────────
// Roll fitness (CTL) forward week by week using the same load brain, so the
// home page can show the expected trajectory. Uses locked weeks where they
// exist (planned=true) and the periodized target elsewhere; with multiple
// events it builds → tapers → rebuilds across the whole race season.
function mondayOfDate(date) {
  const d = new Date(date)
  d.setDate(d.getDate() + (d.getDay() === 0 ? -6 : 1 - d.getDay()))
  d.setHours(0, 0, 0, 0)
  return d
}
function mondayOfPlanWeek(planStart, weekNum) {
  const d = new Date(planStart)
  d.setDate(d.getDate() + (weekNum - 1) * 7)
  return mondayOfDate(d)
}

// Daily CTL projection so the curve is smooth and each event's load lands on
// its actual day (not smeared across the week). Returns one point per day.
export function projectLoad({ currentCtl = 0, recentWeeklyTss = 0, planStart, currentWeekNum = 1, events = [], user = {}, plannedWeeks = [] }) {
  const goal = user.fitness_goal || 'build'
  const weeklyHoursStart = user.weekly_hours_start || 0
  const daysPerWeek = user.days_per_week || 5
  const DAY = 86400000

  const evParsed = (events || []).map(e => ({ ...e, _date: parseLocalDate(e.date) })).filter(e => e._date)
  let horizon = 12
  if (evParsed.length) {
    const last = evParsed.map(e => e._date).sort((a, b) => a - b).pop()
    const wk = Math.round((mondayOfDate(last) - mondayOfPlanWeek(planStart, currentWeekNum)) / (7 * DAY))
    horizon = clamp(wk + 2, 4, 52)
  }
  // Event TSS keyed by day (the big one-off race stimulus, on the real date).
  const eventTssByKey = {}
  evParsed.forEach(e => { const k = localDateStr(e._date); eventTssByKey[k] = (eventTssByKey[k] || 0) + estimateEventTss(e) })

  const plannedByNum = {}
  ;(plannedWeeks || []).forEach(w => { plannedByNum[w.week_num] = w })

  const series = []
  let ctl = currentCtl
  let prevTss = recentWeeklyTss
  for (let i = 0; i < horizon; i++) {
    const weekNum = currentWeekNum + i
    const weekStart = mondayOfPlanWeek(planStart, weekNum)
    const ev = nextEvent(events, weekStart)
    const weeksToEvent = ev?._date ? Math.max(0, Math.round((mondayOfDate(ev._date) - weekStart) / (7 * DAY))) : null
    const pe = prevEvent(events, weekStart)
    const weeksSinceEvent = pe?._date ? Math.max(0, Math.round((weekStart - mondayOfDate(pe._date)) / (7 * DAY))) : null
    let trainingTss, planned = false
    if (plannedByNum[weekNum]) {
      trainingTss = weekTss(plannedByNum[weekNum].sessions); planned = true
    } else {
      trainingTss = computeWeekTarget(
        { goal, freshness: 3, focus: 'none', busy: false },
        { currentTsb: null, recentWeeklyTss: prevTss, weeklyHoursStart, daysPerWeek, weeksToEvent, weeksSinceEvent, weekNum }
      ).targetTss
    }
    const dailyTraining = trainingTss / 7
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart.getTime() + d * DAY)
      const evTss = eventTssByKey[localDateStr(day)] || 0 // event load on its real day only
      ctl += ((dailyTraining + evTss) - ctl) / 42
      series.push({ date: day, ctl: Math.round(ctl), planned })
    }
    prevTss = trainingTss
  }
  return series
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
