// ── Training plan generator ──────────────────────────────────
// Builds a personalised plan from a user profile.
// Zones are calculated from FTP; descriptions adapt to event type.

import { getPlanStart } from './schedule'

export const ZONE_DEFINITIONS = [
  { z: 'Z1', name: 'Recovery',   factors: [0.00, 0.55] },
  { z: 'Z2', name: 'Endurance',  factors: [0.56, 0.75] },
  { z: 'Z3', name: 'Tempo',      factors: [0.76, 0.90] },
  { z: 'Z4', name: 'Threshold',  factors: [0.91, 1.05] },
  { z: 'Z5', name: 'VO2 max',    factors: [1.06, 1.20] },
]

export function getZoneWatts(zone, ftp) {
  if (!ftp) return null
  const def = ZONE_DEFINITIONS.find(z => z.z === zone)
  if (!def) return null
  return {
    lo: Math.round(def.factors[0] * ftp),
    hi: Math.round(def.factors[1] * ftp),
  }
}

export function getZoneLabel(zone, ftp) {
  const w = getZoneWatts(zone, ftp)
  if (!w || !ftp) return zone
  return `${zone} (${w.lo}–${w.hi}W)`
}

// ── Pace zones (run & swim) ──────────────────────────────────
// Pace is the inverse of effort: each zone is a band of speed expressed as a
// fraction of the athlete's threshold speed, so a faster fraction → a smaller
// (quicker) pace number. Threshold (Z4) sits at ~1.0. Bands are per-discipline.
const RUN_SPEED_BANDS = { // fraction of threshold-pace speed
  Z1: [0.70, 0.80], Z2: [0.80, 0.87], Z3: [0.87, 0.94], Z4: [0.94, 1.02], Z5: [1.02, 1.12],
}
const SWIM_SPEED_BANDS = { // fraction of CSS speed
  Z1: [0.80, 0.88], Z2: [0.88, 0.93], Z3: [0.93, 0.98], Z4: [0.98, 1.03], Z5: [1.03, 1.12],
}

// `threshold` is seconds per km (run) or per 100m (swim). Returns { slow, fast }
// in the same unit (slow = bigger number), or null when no threshold is set.
function paceBand(bands, zone, threshold) {
  const b = bands[zone]
  if (!b || !threshold) return null
  return { slow: Math.round(threshold / b[0]), fast: Math.round(threshold / b[1]) }
}
export const getRunPace = (zone, thresholdPaceSecPerKm) => paceBand(RUN_SPEED_BANDS, zone, thresholdPaceSecPerKm)
export const getSwimPace = (zone, cssSecPer100m) => paceBand(SWIM_SPEED_BANDS, zone, cssSecPer100m)

// Seconds → "m:ss" (e.g. 312 → "5:12").
export function fmtPace(sec) {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// RPE labels
export const RPE_LABELS = ['', 'Very easy', 'Easy', 'Moderate', 'Hard', 'Max effort']
export const RPE_FEEDBACK = [
  '',
  'Felt too easy — you can nudge intensity slightly next time.',
  'Good, comfortable effort — absorbing the training well.',
  'About right — right where you should be.',
  'Harder than expected — keep an eye on fatigue accumulation.',
  'Too much — back off next session, prioritise recovery.',
]

// Phase structure based on weeks available
function buildPhases(weeks) {
  if (weeks <= 6) {
    return [
      { name: 'Base + build', weeks: Math.ceil(weeks * 0.5), type: 'base' },
      { name: 'Race-specific', weeks: Math.floor(weeks * 0.35), type: 'race-prep' },
      { name: 'Taper', weeks: Math.max(1, Math.floor(weeks * 0.15)), type: 'taper' },
    ]
  }
  if (weeks <= 10) {
    return [
      { name: 'Base aerobic', weeks: Math.round(weeks * 0.3), type: 'base' },
      { name: 'Threshold build', weeks: Math.round(weeks * 0.35), type: 'build' },
      { name: 'Race-specific', weeks: Math.round(weeks * 0.2), type: 'race-prep' },
      { name: 'Taper', weeks: Math.max(1, weeks - Math.round(weeks*0.3) - Math.round(weeks*0.35) - Math.round(weeks*0.2)), type: 'taper' },
    ]
  }
  // 11+ weeks — full plan
  const base = Math.round(weeks * 0.3)
  const build = Math.round(weeks * 0.3)
  const racePrep = Math.round(weeks * 0.25)
  const taper = Math.max(2, weeks - base - build - racePrep)
  return [
    { name: 'Base aerobic', weeks: base, type: 'base' },
    { name: 'Threshold build', weeks: build, type: 'build' },
    { name: 'Race-specific', weeks: racePrep, type: 'race-prep' },
    { name: 'Taper', weeks: taper, type: 'taper' },
  ]
}

// Volume ramp per week
function buildVolumeRamp(weeks, startHrs, daysPerWeek) {
  const maxHrs = Math.min(startHrs * 1.8, daysPerWeek * 3)
  const taperStart = Math.max(weeks - 2, Math.floor(weeks * 0.85))
  const hrs = []
  for (let i = 0; i < weeks; i++) {
    const isRecovery = i > 0 && (i + 1) % 4 === 0 && i < taperStart
    const isTaper = i >= taperStart
    if (isTaper) {
      const taperWeeks = weeks - taperStart
      const progress = (i - taperStart) / Math.max(taperWeeks - 1, 1)
      hrs.push(Math.round((maxHrs * (0.65 - 0.3 * progress)) * 2) / 2)
    } else if (isRecovery) {
      hrs.push(Math.round(startHrs * 0.75 * 2) / 2)
    } else {
      const buildProgress = Math.min(i / taperStart, 1)
      hrs.push(Math.round((startHrs + (maxHrs - startHrs) * buildProgress) * 2) / 2)
    }
  }
  return hrs
}

// Session templates by phase + event type
function getSessionsForWeek(phaseType, weekInPhase, phaseLength, profile, ftp) {
  const { event_type, days_per_week, riding_strength } = profile
  const isSpeedEvent = ['criterium', 'road_race'].includes(event_type)
  const isEnduranceEvent = ['gran_fondo', 'sportive', 'other'].includes(event_type)
  const isFinalWeekOfPhase = weekInPhase === phaseLength - 1

  const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const restDay = { name: 'Rest', zone: 'rest', desc: 'Full rest. Sleep, hydrate, eat well.' }

  // Base phase sessions
  if (phaseType === 'base') {
    const sessions = [
      restDay,
      { name: 'Endurance Z2', zone: 'z2', desc: `75 min steady at ${ftp ? getZoneLabel('Z2', ftp) : 'Z2'}. Keep effort controlled — no drifting into tempo.` },
      { name: 'Recovery spin', zone: 'z1', desc: '45 min easy. Legs only, no intensity.' },
      { name: isFinalWeekOfPhase ? 'Sweet spot intro' : 'Z2 + accelerations', zone: isFinalWeekOfPhase ? 'z3' : 'z2',
        desc: isFinalWeekOfPhase
          ? `80 min with 2 × 10 min at ${ftp ? getZoneLabel('Z3', ftp) : 'sweet spot'}. 5 min easy between.`
          : '90 min Z2. Include 4 × 30-sec accelerations at the end to maintain snap.' },
      restDay,
      { name: 'Long ride', zone: 'z2', desc: `${weekInPhase < 2 ? '2.5' : '3'} hr endurance. Practise fuelling every 30 min — ${isEnduranceEvent ? 'this is a race skill as much as a fitness one' : 'sustain Z2 throughout'}.` },
      { name: 'Easy spin', zone: 'z1', desc: '45–60 min very easy. Social pace or solo.' },
    ]
    return trimToDays(sessions, days_per_week, ALL_DAYS)
  }

  // Build phase sessions
  if (phaseType === 'build') {
    const ftpTarget = ftp ? `${Math.round(ftp * 0.97)}–${ftp}W` : '95–100% FTP'
    const ssTarget = ftp ? `${Math.round(ftp * 0.88)}–${Math.round(ftp * 0.94)}W` : '88–94% FTP'
    const sessions = [
      restDay,
      { name: isFinalWeekOfPhase ? 'Over-unders' : 'FTP intervals', zone: 'z4',
        desc: isFinalWeekOfPhase
          ? `90 min: 3 × 15 min over-under (1 min at ${ftp ? Math.round(ftp * 1.1) + 'W' : '110% FTP'} / 2 min at ${ftp ? Math.round(ftp * 0.95) + 'W' : '95% FTP'}).`
          : `80 min: 3 × 12 min at ${ftpTarget}. 6 min full recovery between. Key session.` },
      { name: 'Recovery spin', zone: 'z1', desc: '45 min easy Z1.' },
      { name: 'Sweet spot', zone: 'z3',
        desc: `90 min with 2 × 20 min at ${ssTarget}. Sustain smooth power — don't spike.` },
      restDay,
      { name: isEnduranceEvent ? 'Long ride with tempo' : 'Race-simulation ride', zone: 'z3',
        desc: isEnduranceEvent
          ? `3.5 hr. First 2 hrs Z2, then 2 × 20 min at tempo. Practice pushing when tired.`
          : `2.5 hr with 4 × 5 min hard efforts. Simulate race surges. Stay aggressive on climbs.` },
      { name: 'Easy recovery', zone: 'z1', desc: '45–60 min very easy.' },
    ]
    return trimToDays(sessions, days_per_week, ALL_DAYS)
  }

  // Race-prep phase
  if (phaseType === 'race-prep') {
    const ftpTarget = ftp ? `${ftp}W` : '100% FTP'
    const sessions = [
      restDay,
      { name: 'Threshold blocks', zone: 'z4',
        desc: isEnduranceEvent
          ? `90 min: 2 × 20 min at ${ftpTarget}. This is the race-winning session.`
          : `80 min: 5 × 5 min at ${ftp ? Math.round(ftp * 1.05) + 'W' : '105% FTP'}. 5 min recovery. Sharpening speed.` },
      { name: 'Recovery spin', zone: 'z1', desc: '45 min easy.' },
      { name: isEnduranceEvent ? 'Climbing repeats' : 'Criterium simulation', zone: 'z4',
        desc: isEnduranceEvent
          ? `90 min on climbs. 5 × 8 min at ${ftpTarget} on ascents.`
          : `60 min with 6 × 3 min at ${ftp ? Math.round(ftp * 1.1) + 'W' : '110% FTP'} — simulate crit attacks.` },
      restDay,
      { name: isEnduranceEvent ? 'Long race-pace ride' : 'Hard group-pace ride', zone: 'z3',
        desc: isEnduranceEvent
          ? `${weekInPhase === 0 ? '4' : '4.5'} hr. Use race kit + race nutrition. Push the final 30 min.`
          : `2 hr hard. Sustained high tempo — simulate race pace throughout.` },
      { name: 'Easy recovery', zone: 'z1', desc: '45–60 min very easy.' },
    ]
    return trimToDays(sessions, days_per_week, ALL_DAYS)
  }

  // Taper
  if (phaseType === 'taper') {
    const isRaceWeek = weekInPhase === phaseLength - 1
    if (isRaceWeek) {
      return [
        { day: 'Mon', name: 'Rest', zone: 'rest', desc: 'Rest. Final gear check.' },
        { day: 'Tue', name: 'Short sharp session', zone: 'z4', desc: `45 min: 3 × 5 min at ${ftp ? ftp + 'W' : 'FTP'} + 3 × 6-sec sprints. Wake the system up.` },
        { day: 'Wed', name: 'Easy spin', zone: 'z1', desc: '30 min very easy. Stay loose.' },
        { day: 'Thu', name: 'Openers', zone: 'z2', desc: '45 min with 5 × 30-sec race-pace efforts. Legs should feel springy.' },
        { day: 'Fri', name: 'Travel / setup', zone: 'rest', desc: 'Get to the venue. Register. Short 20 min easy spin to check bike. Eat well, sleep early.' },
        { day: 'Sat', name: 'Pre-race activation', zone: 'z1', desc: '20 min very easy + 4 × 10-sec accelerations. Then rest, hydrate, carb-load.' },
        { day: 'Sun', name: 'RACE DAY', zone: 'z5', desc: `${profile.event_name || 'Your event'}. Execute your plan. You've earned this.` },
      ]
    }
    return [
      { day: 'Mon', name: 'Rest', zone: 'rest', desc: 'Rest.' },
      { day: 'Tue', name: 'Short threshold', zone: 'z4', desc: `60 min: 2 × 8 min at ${ftp ? ftp + 'W' : 'FTP'}. Shorter but sharp.` },
      { day: 'Wed', name: 'Easy spin', zone: 'z1', desc: '45 min Z1.' },
      { day: 'Thu', name: 'Sweet spot + sprints', zone: 'z3', desc: `60 min. 2 × 10 min sweet spot + 4 × 8-sec sprints. Legs stay sharp.` },
      { day: 'Fri', name: 'Rest', zone: 'rest', desc: 'Rest.' },
      { day: 'Sat', name: 'Moderate ride', zone: 'z2', desc: '2 hr controlled. A couple of tempo efforts but nothing deep.' },
      { day: 'Sun', name: 'Easy', zone: 'z1', desc: '45 min easy.' },
    ]
  }

  return []
}

// Trim session list to available training days
function trimToDays(sessions, daysPerWeek, allDays) {
  // Always keep Mon as rest, Sat as long ride, Sun as easy
  // Fill mid-week based on days available
  const result = sessions.slice(0, 7).map((s, i) => ({ ...s, day: allDays[i] }))
  if (daysPerWeek >= 5) return result
  // Remove Wed (easy spin) and/or Fri (rest already) for fewer days
  if (daysPerWeek === 4) {
    return result.filter((_, i) => i !== 2) // remove Wed recovery
  }
  if (daysPerWeek === 3) {
    return result.filter((_, i) => ![2, 3].includes(i)) // remove Wed + Thu
  }
  return result
}

// ── Main export ──────────────────────────────────────────────

export function generatePlan(profile) {
  const {
    weeks_available,
    weekly_hours_start = 6,
    ftp,
    days_per_week = 5,
    event_name,
    event_date,
  } = profile

  const weeks = Math.max(4, Math.min(52, weeks_available || 13))
  const phases = buildPhases(weeks)
  const volumeRamp = buildVolumeRamp(weeks, weekly_hours_start, days_per_week)

  // Anchor to the user's fixed plan start (today if unset) so the plan
  // progresses through real time instead of re-anchoring on every load.
  const startDate = getPlanStart(profile)
  const plan = []
  let globalWeek = 0

  phases.forEach(phase => {
    for (let w = 0; w < phase.weeks; w++) {
      const weekNum = globalWeek + 1
      const weekStart = new Date(startDate)
      weekStart.setDate(startDate.getDate() + globalWeek * 7)

      const isRecovery = w > 0 && (w + 1) % 4 === 0 && phase.type !== 'taper'
      const sessions = isRecovery
        ? getRecoverySessions(ftp)
        : getSessionsForWeek(phase.type, w, phase.weeks, profile, ftp)

      plan.push({
        num: weekNum,
        phase: phase.type,
        phaseLabel: phase.name,
        label: isRecovery ? 'Recovery week' : `${phase.name} ${w + 1}`,
        hrs: volumeRamp[globalWeek],
        dateStr: weekStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }),
        isRecovery,
        sessions,
      })

      globalWeek++
    }
  })

  return plan
}

function getRecoverySessions(ftp) {
  return [
    { day: 'Mon', name: 'Rest', zone: 'rest', desc: 'Full rest.' },
    { day: 'Tue', name: 'Easy Z2', zone: 'z2', desc: `60 min Z2. ${ftp ? `Stay below ${Math.round(ftp * 0.75)}W.` : 'No intensity.'} Let the body absorb last block's work.` },
    { day: 'Wed', name: 'Rest', zone: 'rest', desc: 'Rest.' },
    { day: 'Thu', name: 'Optional FTP test', zone: 'z4', desc: 'Good week to do a ramp test and update your zones. Or just 75 min sweet spot if skipping.' },
    { day: 'Fri', name: 'Rest', zone: 'rest', desc: 'Rest.' },
    { day: 'Sat', name: 'Moderate long ride', zone: 'z2', desc: '2 hr easy. No pressure — consolidation only.' },
    { day: 'Sun', name: 'Easy', zone: 'z1', desc: '45 min Z1.' },
  ]
}

// ── Adaptive coaching ────────────────────────────────────────
// Balances three confirmed signals over the recently-elapsed weeks:
// explicit bails (missed), completions, and RPE of hard sessions.
// Unconfirmed (pending) past sessions are never counted — a "miss"
// only ever comes from an explicit bail. The returned directive drives
// both the coaching banner and the upcoming-week adjustments.

const ZONE_ORDER = ['z1', 'z2', 'z3', 'z4', 'z5']
const INTENSE = ['z3', 'z4', 'z5']

export function computeAdaptation(plan, sessionState, currentWeek) {
  const from = Math.max(1, currentWeek - 2)
  const to = currentWeek - 1
  if (to < from) return null

  let completed = 0
  let bailed = 0
  const hardRPEs = []
  plan.forEach(week => {
    if (week.num < from || week.num > to) return
    week.sessions.forEach((s, i) => {
      if (s.zone === 'rest') return
      const st = sessionState[`w${week.num}_${i}`] || {}
      if (st.bailed) bailed++
      else if (st.completed) {
        completed++
        if (INTENSE.includes(s.zone) && st.rpe) hardRPEs.push(st.rpe)
      }
    })
  })

  const confirmed = completed + bailed
  if (confirmed === 0) return null
  const missRate = bailed / confirmed
  const avgHardRPE = hardRPEs.length ? hardRPEs.reduce((a, b) => a + b, 0) / hardRPEs.length : null

  if (bailed >= 2 || missRate >= 0.4) {
    return { tone: 'warning', icon: 'ti-heart-handshake', factor: 0.85, intensity: 'soften',
      reason: 'eased after missed sessions',
      msg: `You've missed ${bailed} session${bailed === 1 ? '' : 's'} recently — easing the next block so you can get back on track. Consistency beats heroics.` }
  }
  if (avgHardRPE !== null && avgHardRPE >= 4.5) {
    return { tone: 'warning', icon: 'ti-alert-triangle', factor: 0.9, intensity: 'soften',
      reason: 'eased after very hard ratings',
      msg: 'Your hard sessions are rating very high. Backing off the next block slightly — adaptation happens in recovery, not by grinding through fatigue.' }
  }
  if (avgHardRPE !== null && avgHardRPE >= 3.8) {
    return { tone: 'push', icon: 'ti-flame', factor: 1, intensity: 'none',
      msg: 'Sessions are feeling tough — normal for this phase. Prioritise quality reps over grinding through all of them fatigued.' }
  }
  if (completed >= 3 && avgHardRPE !== null && avgHardRPE <= 1.8) {
    return { tone: 'go', icon: 'ti-trending-up', factor: 1.05, intensity: 'raise',
      reason: 'progressed — sessions felt easy',
      msg: "You're nailing your sessions and they're coming easy — stepping things up. Expect a touch more load and intensity ahead." }
  }
  if (avgHardRPE !== null && avgHardRPE <= 2.5) {
    return { tone: 'good', icon: 'ti-check', factor: 1, intensity: 'none',
      msg: 'Training is landing well. Stay disciplined with the plan — this is where adaptation compounds.' }
  }
  return { tone: 'hold', icon: 'ti-target', factor: 1, intensity: 'none',
    msg: 'Load is landing right. Hit the prescribed targets and trust the process.' }
}

// Index of the single hardest (highest-zone, z3+) session in a week, or -1.
function hardestIdx(sessions) {
  let bestIdx = -1
  let bestRank = ZONE_ORDER.indexOf('z3') - 1
  sessions.forEach((s, i) => {
    const rank = ZONE_ORDER.indexOf(s.zone)
    if (s.zone !== 'rest' && rank > bestRank) { bestRank = rank; bestIdx = i }
  })
  return bestIdx
}

function softenHardest(sessions) {
  const i = hardestIdx(sessions)
  if (i < 0) return sessions
  const s = sessions[i]
  const lower = ZONE_ORDER[Math.max(0, ZONE_ORDER.indexOf(s.zone) - 1)]
  const copy = sessions.slice()
  copy[i] = { ...s, zone: lower, name: `${s.name} (eased)`, desc: `Eased back this week — hold the lower zone and don't chase the original target. ${s.desc}` }
  return copy
}

function raiseHardest(sessions) {
  const i = hardestIdx(sessions)
  if (i < 0) return sessions
  const s = sessions[i]
  const copy = sessions.slice()
  copy[i] = { ...s, name: `${s.name} (progressed)`, desc: `Progressed — add ~5W to the target or one extra interval. ${s.desc}` }
  return copy
}

// Scale only the *leading* duration of a session description (its overall
// length), leaving interval prescriptions after a colon/"with" intact. Minutes
// round to the nearest 5, hours to the nearest 0.5.
function roundMins(m) { return Math.max(5, Math.round(m / 5) * 5) }
function roundHrs(h) { return Math.max(0.5, Math.round(h * 2) / 2) }

function scaleLeadingDuration(desc, factor) {
  if (!desc || factor === 1) return desc
  const range = desc.match(/^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i)
  if (range) {
    const isHr = range[3][0].toLowerCase() === 'h'
    const lo = isHr ? roundHrs(+range[1] * factor) : roundMins(+range[1] * factor)
    const hi = isHr ? roundHrs(+range[2] * factor) : roundMins(+range[2] * factor)
    return desc.replace(range[0], `${lo}–${hi} ${isHr ? 'hr' : 'min'}`)
  }
  const single = desc.match(/^(\d+(?:\.\d+)?)\s*(min|mins|minutes|hr|hrs|hour|hours)\b/i)
  if (single) {
    const isHr = single[2][0].toLowerCase() === 'h'
    const val = isHr ? roundHrs(+single[1] * factor) : roundMins(+single[1] * factor)
    return desc.replace(single[0], `${val} ${isHr ? 'hr' : 'min'}`)
  }
  return desc
}

// Returns a new plan with upcoming weeks (num > currentWeek) adjusted per the
// adaptation directive. Deterministic — recompute from sessionState each render.
export function applyAdaptation(plan, adaptation, currentWeek) {
  if (!adaptation || (adaptation.factor === 1 && adaptation.intensity === 'none')) return plan
  return plan.map(week => {
    if (week.num <= currentWeek) return week
    const hrs = adaptation.factor !== 1 ? Math.round(week.hrs * adaptation.factor * 2) / 2 : week.hrs
    let sessions = week.sessions
    // Rescale each session's overall duration to track the volume change…
    if (adaptation.factor !== 1) {
      sessions = sessions.map(s => s.zone === 'rest' ? s : { ...s, desc: scaleLeadingDuration(s.desc, adaptation.factor) })
    }
    // …then soften/raise the hardest session (operates on the rescaled copy).
    if (adaptation.intensity === 'soften') sessions = softenHardest(sessions)
    else if (adaptation.intensity === 'raise') sessions = raiseHardest(sessions)
    if (hrs === week.hrs && sessions === week.sessions) return week
    return { ...week, hrs, sessions, adjusted: true, adjustReason: adaptation.reason }
  })
}
