// ── Guided weekly planner (load-driven) ──────────────────────
// The "brain" for the flexibility-centric mode. Each week:
//   1. computeWeekTarget() picks a target weekly load (TSS) from recent
//      fitness (CTL), your goal (maintain/build), event proximity (volume
//      ramps up as it nears, then tapers), freshness and a busy-week flag.
//   2. draftWeek() lays sessions onto the days you're available, sized to
//      your time budget and scaled toward the target, then you edit + lock.
// Output sessions match the app-wide plan shape so every downstream feature
// (calendar, streak, training load, Strava auto-complete) just works.

import { getZoneLabel, getRunPace, getSwimPace, fmtPace } from './planGenerator'
import { nextEvent, prevEvent, parseLocalDate, localDateStr } from './schedule'
import { eventSport, disciplinesFor } from './sports'

const ZONE_IF = { z1: 0.45, z2: 0.65, z3: 0.83, z4: 0.98, z5: 1.13 }
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// TSS for a zone held for `minutes`. Mirrors trainingLoad.js's model.
// Strength is a non-cycling stimulus — it carries no power-based TSS.
export function tssFor(zone, minutes) {
  if (zone === 'strength') return 0
  const IF = ZONE_IF[zone] || 0.65
  return Math.round((minutes / 60) * IF * IF * 100)
}

// Strength sessions are offered when no event is within 5 weeks (or there's no
// event at all) — the open-ended base/off-season window where durability work
// off the bike adds the most. Threshold lives here so UI + model agree.
export function strengthEligible(weeksToEvent) {
  return weeksToEvent == null || weeksToEvent >= 5
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Estimated TSS of doing the event itself (a big one-off stimulus), from its
// type + distance. Used so the projection bumps up on the event, not just dips.
const EVENT_SPEED = { road_race: 38, criterium: 40, time_trial: 40, gran_fondo: 29, sportive: 28, other: 30 } // km/h
const EVENT_IF = { road_race: 0.85, criterium: 0.88, time_trial: 0.92, gran_fondo: 0.78, sportive: 0.76, other: 0.78 }

// Standard triathlon leg distances (km), so a tri's TSS is the sum of its legs.
const TRI_LEGS = {
  tri_sprint:  { swim: 0.75, bike: 20,  run: 5 },
  tri_olympic: { swim: 1.5,  bike: 40,  run: 10 },
  tri_70_3:    { swim: 1.9,  bike: 90,  run: 21.1 },
  tri_ironman: { swim: 3.8,  bike: 180, run: 42.2 },
}
const legTss = (km, speed, IF) => clamp(km / speed, 0.1, 12) * IF * IF * 100

export function estimateEventTss(event) {
  if (!event) return 0
  const type = event.event_type || 'other'
  const sport = eventSport(type)

  if (sport === 'tri') {
    const legs = TRI_LEGS[type] || TRI_LEGS.tri_olympic
    const long = type === 'tri_70_3' || type === 'tri_ironman' // lower intensity, longer day
    const tss = legTss(legs.swim, 3.0, long ? 0.72 : 0.80)
      + legTss(legs.bike, long ? 31 : 30, long ? 0.70 : 0.80)
      + legTss(legs.run, 10, long ? 0.74 : 0.82)
    return Math.round(tss)
  }

  if (sport === 'run') {
    const km = event.distance_km || 10
    // Shorter races run faster and harder; the marathon is steadier.
    const speed = km <= 5 ? 12.5 : km <= 10 ? 11.5 : km <= 21.1 ? 10.8 : 10 // km/h
    const IF = km <= 5 ? 0.92 : km <= 10 ? 0.90 : km <= 21.1 ? 0.86 : 0.82
    return Math.round(clamp(km / speed, 0.25, 5) * IF * IF * 100)
  }

  // Cycling (unchanged).
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
  const { currentTsb = null, currentCtl = null, recentWeeklyTss = 0, weeklyHoursStart = 0, daysPerWeek = 5, weeksToEvent = null, weeksSinceEvent = null, weekNum = 1, eventType = null, riderType = 'all_rounder' } = ctx

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

  // A true recovery week (all-easy) is a *scheduled/structural* deload: a manual
  // toggle, the week after a race, or every 4th week. Deep fatigue is handled
  // separately below — it eases volume and holds intensity until you've recovered
  // *within* the week, rather than writing the whole week off.
  const deeplyFatigued = currentTsb != null && currentTsb <= -25
  const postEventRecovery = weeksSinceEvent === 1
  const isRecovery = focus === 'recovery' || postEventRecovery || (weekNum > 0 && weekNum % 4 === 0)
  const freshnessFactor = [0.85, 0.85, 0.92, 1.0, 1.05, 1.1][clamp(freshness, 1, 5)]
  const busyFactor = busy ? 0.7 : 1

  // Take the more conservative of the event taper and the post-event re-entry
  // so neither over-rides the other when events are close together.
  let factor = Math.min(eventFactor, reentryFactor) * freshnessFactor * busyFactor
  if (reentryFactor < 1 && eventFactor >= 1) phase = 'Rebuild'
  if (isRecovery) { factor = 0.6 * busyFactor; phase = postEventRecovery ? 'Post-race recovery' : 'Recovery' }
  else if (deeplyFatigued) { factor *= 0.8; phase = 'Fatigued' } // lighter, but not all-easy

  let targetHours = baseHours * factor
  targetHours = clamp(targetHours, startHours * (isRecovery ? 0.4 : 0.5), maxHours * 1.05)
  targetHours = Math.round(targetHours * 2) / 2

  // Auto intensity: how many quality days and which zones, from event + rider
  // type + phase + fatigue. Replaces the old manual easy/hard choice.
  const quality = planQuality({
    eventType, riderType, goal, weeksToEvent, weeksSinceEvent,
    currentTsb, busy, isRecovery, availDays: countAvailable(inputs),
  })

  // Deep fatigue: don't slot quality onto days you haven't recovered for. Project
  // form (TSB) forward across the week from an all-easy baseline and only allow
  // quality once it climbs back above the readiness line — typically later in the
  // week — capping it to a single day.
  if (!isRecovery && deeplyFatigued && quality.count > 0) {
    applyReadinessGate(quality, { inputs, currentCtl, currentTsb })
  }
  quality.reason = buildIntensityReason({
    isRecovery, postEventRecovery, weekNum, deeplyFatigued, currentTsb, quality, weeksToEvent,
  })

  return {
    targetHours,
    targetTss: Math.round(targetHours * TSS_PER_HOUR),
    isRecovery,
    phase,
    quality,
    hardDays: quality.count, // kept for any legacy reader
    note: buildNote({ phase, goal, weeksToEvent, weeksSinceEvent, isRecovery, busy, deeplyFatigued }),
  }
}

// ── Form-aware readiness gate ─────────────────────────────────
const READY_TSB = -20 // form must climb back above this before quality returns

// An easy day's estimated load, by length — the baseline we recover along.
const easyDayLoad = minutes => tssFor(minutes <= 45 ? 'z1' : 'z2', minutes)

// Roll CTL/ATL forward Mon→Sun along an all-easy version of the week and find
// the first riding day on which form (the TSB you *carry into* that day) has
// recovered past READY_TSB. Mutates `quality`: holds it to ≤1 day from that day
// on, or zeroes it if recovery never gets there this week.
function applyReadinessGate(quality, { inputs, currentCtl, currentTsb }) {
  if (currentCtl == null || currentTsb == null) return // no form data → leave as-is
  const days = inputs?.days || {}
  let ctl = currentCtl
  let atl = currentCtl - currentTsb // ATL = CTL − TSB
  let earliest = null
  for (const day of DAY_NAMES) {
    const tsbInto = ctl - atl
    if (days[day] && earliest == null && tsbInto >= READY_TSB) earliest = day
    const load = days[day] ? easyDayLoad(TIER_MIN[days[day].length] || 90) : 0
    ctl += (load - ctl) / 42
    atl += (load - atl) / 7
  }
  if (earliest == null) { quality.count = 0; quality.zones = []; quality.earliestDay = null; return }
  quality.count = 1               // one cautious quality day when fatigued
  quality.zones = ['z4']          // threshold is the sensible re-entry — not VO₂ off deep fatigue
  quality.earliestDay = earliest  // draftWeek won't place it before this day
}

// One-line "why this week" explanation of the intensity decision.
function buildIntensityReason({ isRecovery, postEventRecovery, weekNum, deeplyFatigued, currentTsb, quality, weeksToEvent }) {
  const mix = quality.zones.map(z => ({ z3: 'sweet-spot', z4: 'threshold', z5: 'VO₂' }[z] || z)).join(' + ')
  if (isRecovery) {
    if (postEventRecovery) return 'Recovery week after your event — all endurance to absorb it.'
    if (weekNum > 0 && weekNum % 4 === 0) return 'Scheduled recovery week (every 4th week) — all endurance to absorb the block.'
    return 'Recovery week — all endurance, intensity paused.'
  }
  if (deeplyFatigued) {
    if (quality.count === 0) return `Form is deep in the red (TSB ${Math.round(currentTsb)}) — endurance only this week while you recover.`
    return `Form is deep in the red (TSB ${Math.round(currentTsb)}) — easy early week, then a ${mix} day later on once your form's back out of the red (≈ ${quality.earliestDay}).`
  }
  if (quality.count === 0) return 'All endurance this week — building aerobic base.'
  const taper = weeksToEvent != null && weeksToEvent <= 2
  return `${quality.count} quality day${quality.count > 1 ? 's' : ''} · ${mix}${taper ? ' — sharpening for your event' : ''}.`
}

// ── Auto intensity engine ────────────────────────────────────
// Decides the week's quality (above-endurance) work — how many days and which
// zones — so the rider never has to guess. Driven by event type + proximity
// (phase), rider type, goal and fatigue. Returns { count, zones } where zones is
// hardest-first (e.g. ['z5','z4']).

// Race-specific zone menus, most specific first. z3 sweet-spot, z4 threshold,
// z5 VO₂/anaerobic.
const EVENT_ZONES = {
  criterium:  ['z5', 'z4', 'z3'],
  road_race:  ['z4', 'z5', 'z3'],
  time_trial: ['z4', 'z3', 'z4'],
  gran_fondo: ['z3', 'z4', 'z3'],
  sportive:   ['z3', 'z3', 'z4'],
  other:      ['z4', 'z3', 'z3'],
}
const RIDER_BIAS = { sprinter: 'z5', climber: 'z4', time_trialist: 'z4', all_rounder: null }
const ZONE_HARDNESS = ['z5', 'z4', 'z3', 'z2', 'z1'] // hardest → easiest

function qualityZones(count, eventType, riderType, isBase) {
  if (count <= 0) return []
  let menu = (EVENT_ZONES[eventType] || EVENT_ZONES.other).slice()
  // Base/off-season favours sustainable sweet-spot over VO₂ — except sprinters,
  // whose top end needs touching year-round.
  if (isBase && riderType !== 'sprinter') menu = menu.map(z => (z === 'z5' ? 'z3' : z))
  const zones = []
  for (let i = 0; i < count; i++) zones.push(menu[i % menu.length])
  // Guarantee one slot of the rider's signature zone.
  const bias = RIDER_BIAS[riderType]
  if (bias && !zones.includes(bias)) zones[zones.length - 1] = bias
  return zones.sort((a, b) => ZONE_HARDNESS.indexOf(a) - ZONE_HARDNESS.indexOf(b))
}

export function planQuality(ctx = {}) {
  const { eventType = null, riderType = 'all_rounder', goal = 'build', weeksToEvent = null,
          weeksSinceEvent = null, currentTsb = null, busy = false, isRecovery = false, availDays = 4 } = ctx
  if (isRecovery) return { count: 0, zones: [] }

  // 1. Base count by phase.
  let count
  if (weeksSinceEvent === 1) count = 0                                   // post-race
  else if (weeksSinceEvent === 2) count = 1                              // rebuild
  else if (weeksToEvent != null && weeksToEvent <= 2) count = 1          // taper, stay sharp
  else if (weeksToEvent != null && weeksToEvent <= 8) count = 3          // peak build
  else if (weeksToEvent != null) count = 2                              // base build toward event
  else count = goal === 'build' ? 2 : 1                                  // no event

  // 2. Busyness pulls it back. (Deep fatigue is handled by the readiness gate in
  // computeWeekTarget, which projects recovery rather than blanket-cutting.)
  if (busy) count -= 1

  // 3. Always leave at least one endurance day; cap at 3 quality days.
  count = clamp(count, 0, Math.min(3, Math.max(0, availDays - 1)))

  const isBase = weeksToEvent == null || weeksToEvent > 8
  return { count, zones: qualityZones(count, eventType, riderType, isBase) }
}

// Rough projection of where this week's load leaves your fitness (CTL), so the
// planner can show "CTL 48 → 50" — leaning into the analytics ethos.
export function projectCtl(currentCtl, weeklyTss) {
  const daily = (weeklyTss || 0) / 7
  let ctl = currentCtl || 0
  for (let i = 0; i < 7; i++) ctl += (daily - ctl) / 42
  return Math.round(ctl)
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
// `sport` defaults to 'bike' so every existing caller (and every plan saved
// before multi-sport) is byte-identical — bike sessions carry no `sport` field.
export function buildSession(day, zone, minutes, ftp, isLong = false, sport = 'bike') {
  if (zone === 'rest') return restDay(day)
  if (zone === 'strength') {
    const sm = clamp(Math.round(minutes / 5) * 5, ZONE_META.strength.min, ZONE_META.strength.max)
    return {
      day,
      zone: 'strength',
      name: 'Strength',
      desc: `${fmtDur(sm)} strength & conditioning. Compound lifts + core — build durability off the bike.`,
      durationMin: sm,
    }
  }
  const meta = ZONE_META[zone] || ZONE_META.z2
  const min = clamp(Math.round(minutes / 5) * 5, 10, meta.max)
  const names = ZONE_NAME[sport] || ZONE_NAME.bike
  const isLongEasy = isLong && zone === 'z2'
  const base = {
    day,
    zone,
    name: isLongEasy ? (LONG_NAME[sport] || LONG_NAME.bike) : (names[zone] || meta.name),
    desc: describe(zone, min, ftp, isLong, sport),
    durationMin: min,
  }
  return sport === 'bike' ? base : { ...base, sport }
}

// A brick: a bike effort run straight into a run, on race-tired legs. Modelled
// as a compound session whose load is the sum of its legs (see brickTss).
export function buildBrick(day, bikeMin, runMin, ftp) {
  const bMin = clamp(Math.round((bikeMin || 60) / 5) * 5, 20, 180)
  const rMin = clamp(Math.round((runMin || 20) / 5) * 5, 10, 75)
  return {
    day,
    sport: 'brick',
    zone: 'z3', // representative effort for the card colour / fallbacks
    name: 'Brick',
    desc: `${fmtDur(bMin)} bike straight into a ${fmtDur(rMin)} run — practise running off the bike on race legs.`,
    durationMin: bMin + rMin,
    legs: [
      { sport: 'bike', zone: 'z3', durationMin: bMin, desc: describe('z3', bMin, ftp, false, 'bike') },
      { sport: 'run', zone: 'z2', durationMin: rMin, desc: describe('z2', rMin, ftp, false, 'run') },
    ],
  }
}

// A two-a-day: two independent sessions of different sports on one day (a
// triathlon staple — e.g. a swim plus an easy ride). Unlike a brick they're not
// back-to-back; the day's load is the sum of its parts (see multiTss). Rendered
// in Training weeks as side-by-side half-width banners.
const ZONE_RANK = ['z5', 'z4', 'z3', 'z2', 'z1'] // hardest → easiest
export function buildMulti(day, parts, ftp) {
  const built = parts.map(p => {
    const s = buildSession(day, p.zone, p.durationMin, ftp, false, p.sport)
    return { sport: p.sport, zone: s.zone, durationMin: s.durationMin, name: s.name, desc: s.desc }
  })
  const dom = [...built].map(b => b.zone).sort((a, b) => ZONE_RANK.indexOf(a) - ZONE_RANK.indexOf(b))[0] || 'z2'
  return {
    day,
    sport: 'multi',
    zone: dom, // representative effort for fallbacks
    name: 'Two sessions',
    desc: built.map(b => `${b.name} (${fmtDur(b.durationMin)})`).join(' + '),
    durationMin: built.reduce((s, b) => s + b.durationMin, 0),
    parts: built,
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

export const ZONE_META = {
  z1: { name: 'Recovery spin', min: 30, max: 60 },
  z2: { name: 'Endurance', min: 40, max: 300 },
  z3: { name: 'Sweet spot', min: 45, max: 120 },
  z4: { name: 'Threshold intervals', min: 40, max: 90 },
  z5: { name: 'VO₂ intervals', min: 35, max: 75 },
  strength: { name: 'Strength', min: 20, max: 75 },
}

function fmtDur(min) {
  if (min >= 90) return `${(Math.round(min / 30) * 30) / 60} hr`
  return `${Math.round(min / 5) * 5} min`
}

// Per-sport session titles by effort zone. Bike keeps its exact original names
// (so existing plans are unchanged); run/swim get discipline-appropriate ones.
const ZONE_NAME = {
  bike: { z1: 'Recovery spin', z2: 'Endurance', z3: 'Sweet spot', z4: 'Threshold intervals', z5: 'VO₂ intervals' },
  run:  { z1: 'Recovery jog', z2: 'Easy run', z3: 'Tempo run', z4: 'Threshold run', z5: 'VO₂ intervals' },
  swim: { z1: 'Technique swim', z2: 'Endurance swim', z3: 'Tempo swim', z4: 'Threshold swim', z5: 'Sprint swim' },
}
const LONG_NAME = { bike: 'Long ride', run: 'Long run', swim: 'Long swim' }

function describe(zone, min, ftp, isLong, sport = 'bike') {
  const dur = fmtDur(min)
  if (sport === 'run') return describeRun(zone, dur, isLong)
  if (sport === 'swim') return describeSwim(zone, dur, isLong)
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

// Run/swim prose is effort-based; pace targets (when thresholds are set) are
// layered on at render time in Phase 3, the same way watts are for the bike.
function describeRun(zone, dur, isLong) {
  switch (zone) {
    case 'z1': return `${dur} very easy jog. Conversational, light feet — pure recovery.`
    case 'z2': return isLong
      ? `${dur} long run at an easy aerobic pace. Fuel + hydrate — building time on feet.`
      : `${dur} easy aerobic run. Comfortable, nose-breathing pace, no drifting up.`
    case 'z3': return `${dur} with tempo blocks — "comfortably hard", controlled breathing.`
    case 'z4': return `${dur} of threshold reps near 10k effort. Strong but repeatable, with recoveries.`
    case 'z5': return `${dur} with short, fast VO₂ intervals. Hard efforts, full recoveries — top-end sharpening.`
    default: return `${dur}.`
  }
}

function describeSwim(zone, dur, isLong) {
  switch (zone) {
    case 'z1': return `${dur} easy technique swim. Drills + smooth form, low effort.`
    case 'z2': return isLong
      ? `${dur} continuous endurance swim. Steady aerobic, even pacing throughout.`
      : `${dur} aerobic swim in steady sets. Relaxed, long strokes, short rests.`
    case 'z3': return `${dur} of tempo sets at a "comfortably hard" pace, short rests.`
    case 'z4': return `${dur} of threshold sets near race pace. Controlled and strong, moderate rests.`
    case 'z5': return `${dur} of sprint sets — short and fast with full rest. Top-end speed.`
    default: return `${dur}.`
  }
}

// ── Interval structure ───────────────────────────────────────
// Turns a zone + duration into a concrete interval prescription (e.g. "4 × 12
// min") plus a segment-by-segment profile for the card's visual. Derived
// deterministically so it works for any session that carries a zone + minutes,
// including ones saved before this existed.
const WORKOUT_SCHEME = {
  z3: { on: 15, off: 5, pct: 0.90, label: 'sweet spot' },
  z4: { on: 12, off: 5, pct: 1.00, label: 'threshold' },
  z5: { on: 4,  off: 3, pct: 1.15, label: 'VO₂' },
}
const STEADY_PCT = { z1: 0.50, z2: 0.65 }

// The headline target for a workout: watts (bike), pace/km (run) or pace/100m
// (swim) when the threshold is known, else just the zone name. `opts` carries
// the sport + per-sport thresholds; defaulting to bike keeps every existing
// caller (and the .zwo export) unchanged.
export function workoutTarget(zone, ftp, opts = {}) {
  const Z = zone.toUpperCase()
  const { sport = 'bike', thresholdPaceRun, cssSwim } = opts
  if (sport === 'run') { const p = getRunPace(Z, thresholdPaceRun); return p ? `${fmtPace(p.fast)}–${fmtPace(p.slow)}/km` : Z }
  if (sport === 'swim') { const p = getSwimPace(Z, cssSwim); return p ? `${fmtPace(p.fast)}–${fmtPace(p.slow)}/100m` : Z }
  return ftp ? getZoneLabel(Z, ftp) : Z
}

export function buildWorkout(zone, totalMin, ftp, opts = {}) {
  const total = Math.max(20, Math.round(totalMin || 60))
  const target = workoutTarget(zone, ftp, opts)

  // Steady rides: one flat block, no interval breakdown.
  if (!WORKOUT_SCHEME[zone]) {
    return { steady: true, summary: `${fmtDur(total)} steady`, target, total,
      segments: [{ kind: 'steady', min: total, pct: STEADY_PCT[zone] ?? 0.55 }] }
  }

  const sc = WORKOUT_SCHEME[zone]
  const warm = total >= 75 ? 15 : 10
  const cool = 10
  const budget = Math.max(sc.on, total - warm - cool)
  const unit = sc.on + sc.off
  const reps = Math.max(2, Math.floor((budget + sc.off) / unit))

  const segments = [{ kind: 'warmup', min: warm, pct: 0.60 }]
  for (let i = 0; i < reps; i++) {
    segments.push({ kind: 'work', min: sc.on, pct: sc.pct })
    if (i < reps - 1) segments.push({ kind: 'recover', min: sc.off, pct: 0.45 })
  }
  segments.push({ kind: 'cooldown', min: cool, pct: 0.40 })

  return {
    steady: false,
    summary: `${reps} × ${sc.on} min`,
    reps, onMin: sc.on, offMin: sc.off, zoneLabel: sc.label, target, total,
    breakdown: `${warm} min warm-up → ${reps} × (${sc.on} min @ ${target} / ${sc.off} min easy) → ${cool} min cool-down`,
    segments,
  }
}

// Default duration for an opt-in strength session.
const STRENGTH_MIN = 40

// Turn a strength session's duration into a concrete, cyclist-focused
// prescription: warm-up → compound main lifts → accessory → core → cool-down.
// Volume (sets / number of accessory + core moves) scales with the time you've
// set, mirroring how buildWorkout derives intervals — so every strength session
// expands to real detail without storing anything extra on the session.
export function buildStrength(totalMin) {
  const total = clamp(Math.round(totalMin || STRENGTH_MIN), 20, 75)
  const sets = total >= 60 ? 4 : total >= 38 ? 3 : 2
  const accSets = Math.max(2, sets - 1)
  const nAcc = total >= 60 ? 3 : total >= 38 ? 2 : 1
  const nCore = total >= 55 ? 3 : 2

  const main = [
    { name: 'Back squat', reps: '6–8', note: 'Drive through mid-foot, knees tracking over toes.' },
    { name: 'Romanian deadlift', reps: '8', note: 'Hinge from the hips, flat back — load the hamstrings.' },
  ]
  const accessory = [
    { name: 'Bulgarian split squat', reps: '8 / leg', note: 'Single-leg strength + balance for a steadier pedal stroke.' },
    { name: 'Step-ups', reps: '10 / leg' },
    { name: 'Standing calf raise', reps: '15' },
  ]
  const core = [
    { name: 'Plank', detail: `${sets} × 45 s` },
    { name: 'Dead bug', detail: `${sets} × 10 / side` },
    { name: 'Side plank', detail: `${accSets} × 30 s / side` },
  ]

  return {
    total,
    summary: `${sets} × compound + core`,
    blocks: [
      { kind: 'warmup', label: 'Warm-up · ~8 min', items: [
        { name: 'Leg swings + hip openers', detail: '2 min' },
        { name: 'Bodyweight squats', detail: '2 × 10' },
        { name: 'Glute bridges', detail: '2 × 12' },
      ] },
      { kind: 'main', label: 'Main lifts', items: main.map(x => ({ name: x.name, detail: `${sets} × ${x.reps}`, note: x.note })) },
      { kind: 'accessory', label: 'Accessory', items: accessory.slice(0, nAcc).map(x => ({ name: x.name, detail: `${accSets} × ${x.reps}`, note: x.note })) },
      { kind: 'core', label: 'Core', items: core.slice(0, nCore) },
      { kind: 'cooldown', label: 'Cool-down · ~5 min', items: [
        { name: 'Quad + hip-flexor stretch', detail: '5 min' },
      ] },
    ],
  }
}

// Expand a swim session into a warm-up → main set → cool-down prescription,
// the swimmer's analogue of buildWorkout. Rounds scale with the time you set;
// the main set's shape comes from the effort zone. Distances are pool-friendly.
export function buildSwimSets(zone, totalMin) {
  const total = clamp(Math.round(totalMin || 45), 20, 90)
  const rounds = total >= 60 ? 6 : total >= 40 ? 5 : 4
  const main = {
    z1: { name: `${rounds} × 100 m easy`, detail: 'smooth, 20 s rest', note: 'Technique focus — long, relaxed strokes.' },
    z2: { name: `${rounds} × 200 m steady`, detail: '20 s rest', note: 'Aerobic endurance, even splits.' },
    z3: { name: `${rounds} × 150 m tempo`, detail: '20 s rest', note: 'Comfortably hard, hold form.' },
    z4: { name: `${rounds + 1} × 100 m @ threshold (CSS)`, detail: '15 s rest', note: 'Race-pace effort, strong and controlled.' },
    z5: { name: `${rounds + 2} × 50 m fast`, detail: 'full rest', note: 'Sprint speed, full recovery between.' },
  }[zone] || { name: `${rounds} × 200 m steady`, detail: '20 s rest' }
  return {
    total,
    summary: main.name,
    blocks: [
      { kind: 'warmup', label: 'Warm-up', items: [
        { name: '200–300 m easy swim', detail: 'mixed stroke' },
        { name: '4 × 50 m drills', detail: '15 s rest' },
      ] },
      { kind: 'main', label: 'Main set', items: [main] },
      { kind: 'cooldown', label: 'Cool-down', items: [
        { name: '100–200 m easy', detail: 'loosen down' },
      ] },
    ],
  }
}

// Per-day length tiers → minutes. Coarse up front; fine-tune in the draft.
export const TIER_MIN = { S: 45, M: 90, L: 150 }
export const TIER_LABEL = { S: 'Short', M: 'Med', L: 'Long' }

// Choose which days carry the week's quality work, spread away from the long
// ride and each other so hard efforts never stack back-to-back. Greedy: each
// pick maximises the minimum distance to the long day + already-picked days.
function pickQualityDays(candidates, longDay, count) {
  const idx = d => DAY_NAMES.indexOf(d)
  const picked = []
  while (picked.length < count && picked.length < candidates.length) {
    let best = null, bestMin = -1, bestSum = -1
    for (const d of candidates) {
      if (picked.includes(d)) continue
      const refs = [longDay, ...picked].filter(Boolean).map(idx)
      const dists = refs.map(r => Math.abs(r - idx(d)))
      const min = refs.length ? Math.min(...dists) : 99
      const sum = dists.reduce((a, b) => a + b, 0)
      // Maximise the closest gap first; break ties by overall spread.
      if (min > bestMin || (min === bestMin && sum > bestSum)) { bestMin = min; bestSum = sum; best = d }
    }
    picked.push(best)
  }
  return picked
}

// ── Discipline blend from event proximity ────────────────────
// The week's sport mix is driven entirely by how soon each upcoming event is:
// every event contributes to its discipline(s) with a weight that decays with
// distance (1.0 this week, 0.5 next, 0.33 in two, …), and a triathlon feeds all
// three. So a bike race in 2 weeks ahead of a triathlon in 8 yields a mostly-
// bike week with a little swim/run mixed in — and as the race passes and the
// tri nears, the mix shifts toward an even swim/bike/run split.
const SPORT_PRIORITY = ['bike', 'run', 'swim'] // stable tie-break order

export function disciplineWeights(events, weekStart) {
  const w = { bike: 0, run: 0, swim: 0 }
  ;(events || []).forEach(e => {
    const d = parseLocalDate(e.date)
    if (!d) return
    const weeks = Math.round((mondayOfDate(d) - mondayOfDate(weekStart)) / (7 * 86400000))
    if (weeks < 0) return // past events no longer pull
    const prox = 1 / (weeks + 1)
    disciplinesFor(eventSport(e.event_type)).forEach(s => { w[s] += prox })
  })
  return w
}

// Turn discipline weights into a whole number of days each, via largest-
// remainder rounding so the split matches the weights as closely as possible.
function allocateDays(weights, nDays) {
  const total = SPORT_PRIORITY.reduce((a, s) => a + (weights[s] || 0), 0)
  if (total <= 0 || nDays <= 0) return { bike: nDays, run: 0, swim: 0 }
  const raw = {}, counts = {}
  SPORT_PRIORITY.forEach(s => { raw[s] = (weights[s] || 0) / total * nDays; counts[s] = Math.floor(raw[s]) })
  let used = SPORT_PRIORITY.reduce((a, s) => a + counts[s], 0)
  const byRemainder = [...SPORT_PRIORITY].sort((a, b) => (raw[b] - counts[b]) - (raw[a] - counts[a]))
  for (let i = 0; used < nDays; i++, used++) counts[byRemainder[i % byRemainder.length]]++
  return counts
}

// Assign a discipline to each chosen day from the weighted day-counts, spread
// so the same sport doesn't stack three days running; when a triathlon is in
// the mix (swim has days) one weekend bike becomes a brick.
// How many swim sessions a week we aim for when a triathlon is in the mix —
// swimming rewards frequency, so we top up to this with two-a-days if needed.
const SWIM_GOAL = 2

function assignSportsByWeight(onDays, weights, target, days = {}) {
  const nDays = onDays.length
  if (!nDays) return {}
  const counts = allocateDays(weights, nDays)
  const active = SPORT_PRIORITY.filter(s => counts[s] > 0)
  if (active.length <= 1) return Object.fromEntries(onDays.map(d => [d, active[0] || 'bike']))

  const remaining = { ...counts }
  const out = {}
  let prev = null
  onDays.forEach(day => {
    const pick = SPORT_PRIORITY.filter(s => remaining[s] > 0).sort((a, b) => remaining[b] - remaining[a])
    const choice = pick.find(s => s !== prev) || pick[0]
    out[day] = choice
    remaining[choice]--
    prev = choice
  })

  if (!target.isRecovery && counts.swim > 0) {
    const weekendBike = ['Sat', 'Sun'].find(d => out[d] === 'bike')
    if (weekendBike) out[weekendBike] = 'brick'

    // Triathlon two-a-days: if single-sport days didn't give us enough swims,
    // pair a swim onto the shortest ride/run days (the long day sorts last and
    // is left alone) as a second session — out[day] becomes ['swim', baseSport].
    let swims = onDays.filter(d => out[d] === 'swim').length
    const candidates = onDays
      .filter(d => out[d] === 'bike' || out[d] === 'run')
      .sort((a, b) => (TIER_MIN[days[a]?.length] || 90) - (TIER_MIN[days[b]?.length] || 90))
    for (const d of candidates) {
      if (swims >= SWIM_GOAL) break
      out[d] = ['swim', out[d]]
      swims++
    }
  }
  return out
}

// The discipline each chosen day will be, from the proximity-weighted blend.
// A value can be a single sport, 'brick', or a two-sport array (a two-a-day).
// Exported so the planner UI can preview the same badges draftWeek uses.
export function sportsForWeek(inputs, target, weights) {
  const days = inputs?.days || {}
  const onDays = DAY_NAMES.filter(d => days[d])
  return assignSportsByWeight(onDays, weights || { bike: 1, run: 0, swim: 0 }, target, days)
}

// Lay the week out directly from your per-day choices: each on-day carries a
// length (S/M/L) and a type (easy/hard). Off-days are rest. A recovery week
// forces everything easy. `weights` is the proximity-driven discipline blend
// (see disciplineWeights); a week mixes sports whenever events overlap.
export function draftWeek(target, inputs, ftp, weights) {
  const days = inputs?.days || {}
  const onDays = DAY_NAMES.filter(d => days[d])
  if (!onDays.length) return DAY_NAMES.map(restDay)

  // Per-day discipline from the proximity blend.
  const sportByDay = sportsForWeek(inputs, target, weights)

  // Single ride/run days are where endurance + quality live (swim/brick/two-a-
  // day are handled on their own). The long ride = the longest of those.
  const isSingleRide = d => typeof sportByDay[d] === 'string' && sportByDay[d] !== 'swim' && sportByDay[d] !== 'brick'
  const longDay = onDays
    .filter(isSingleRide)
    .sort((a, b) => TIER_MIN[days[b].length] - TIER_MIN[days[a].length])[0]

  // Auto intensity: pick which days carry quality work and which zone each gets,
  // spaced away from the long ride and each other. Zones are hardest-first; we
  // lay them out in calendar order so the hardest lands earliest in the week.
  const quality = target.quality || { count: 0, zones: [] }
  let qCandidates = onDays.filter(d => isSingleRide(d) && d !== longDay)
  // When fatigue has gated quality to later in the week, don't place it before
  // the day form is projected to have recovered.
  if (quality.earliestDay) {
    const minIdx = DAY_NAMES.indexOf(quality.earliestDay)
    qCandidates = qCandidates.filter(d => DAY_NAMES.indexOf(d) >= minIdx)
  }
  const qDays = target.isRecovery ? [] : pickQualityDays(qCandidates, longDay, quality.count)
  const qZoneByDay = {}
  qDays.slice().sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b))
    .forEach((d, i) => { qZoneByDay[d] = quality.zones[i] || 'z4' })

  const byDay = {}
  onDays.forEach(day => {
    const sport = sportByDay[day]
    const { length = 'M' } = days[day]
    let minutes = TIER_MIN[length] || 90
    if (sport === 'brick') { // split the day ~70% bike / 30% run
      byDay[day] = buildBrick(day, Math.round(minutes * 0.7), Math.round(minutes * 0.3), ftp)
      return
    }
    if (Array.isArray(sport)) { // two-a-day: a swim plus an easy ride/run
      const baseSport = sport[1]
      const baseZone = minutes <= 45 ? 'z1' : 'z2'
      const swimMin = clamp(Math.round(minutes * 0.5), 25, 45)
      byDay[day] = buildMulti(day, [
        { sport: 'swim', zone: target.isRecovery ? 'z1' : 'z2', durationMin: swimMin },
        { sport: baseSport, zone: baseZone, durationMin: minutes },
      ], ftp)
      return
    }
    if (sport === 'swim') minutes = Math.min(minutes, 75) // swims don't run long
    let zone
    if (target.isRecovery || sport === 'swim') zone = minutes <= 45 ? 'z1' : 'z2'
    else if (qZoneByDay[day]) zone = qZoneByDay[day] // auto-assigned quality day
    else zone = minutes <= 45 ? 'z1' : 'z2'         // endurance
    byDay[day] = buildSession(day, zone, minutes, ftp, day === longDay && zone === 'z2', sport)
  })

  // Optional strength: drop 1–2 sessions onto otherwise-rest days, preferring
  // days furthest from a demanding ride (hard intervals or the long ride) so
  // they don't blunt key sessions. Never touches a ride day.
  const wantStrength = clamp(Math.round(inputs?.strength || 0), 0, 2)
  if (wantStrength > 0) {
    const idxOf = d => DAY_NAMES.indexOf(d)
    const demanding = onDays
      .filter(d => ['z4', 'z5'].includes(byDay[d]?.zone) || d === longDay)
      .map(idxOf)
    const distToDemand = i => demanding.length ? Math.min(...demanding.map(d => Math.abs(d - i))) : 99
    const restIdx = DAY_NAMES.map((_, i) => i).filter(i => !byDay[DAY_NAMES[i]])
    restIdx
      .sort((a, b) => distToDemand(b) - distToDemand(a) || a - b) // furthest from hard, then earliest
      .slice(0, wantStrength)
      .forEach(i => { byDay[DAY_NAMES[i]] = buildSession(DAY_NAMES[i], 'strength', STRENGTH_MIN, ftp) })
  }

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
    if (!x || x.zone === 'rest' || x.zone === 'strength') return s
    if (x.sport === 'brick') return s + brickTss(x)
    if (x.sport === 'multi') return s + multiTss(x)
    const minutes = x.durationMin != null ? x.durationMin
      : (() => { const m = x.desc?.match(/^(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours|min|mins|minutes)/i); return m ? (m[2][0].toLowerCase() === 'h' ? +m[1] * 60 : +m[1]) : 0 })()
    return s + tssFor(x.zone, minutes)
  }, 0)
}

// Prescribed TSS of a brick = the sum of its legs' load (each leg is a normal
// effort/duration). Used wherever a session's load is summed.
export function brickTss(session) {
  return (session?.legs || []).reduce((s, leg) => s + tssFor(leg.zone, leg.durationMin || 0), 0)
}

// Prescribed TSS of a two-a-day = the sum of its parts' load.
export function multiTss(session) {
  return (session?.parts || []).reduce((s, p) => s + tssFor(p.zone, p.durationMin || 0), 0)
}
