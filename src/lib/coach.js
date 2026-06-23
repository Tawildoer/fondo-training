// ── Ride coach ───────────────────────────────────────────────
// Turns a ride's power stream into time-in-zone, detects whether the ride had
// structure, and compares it against what was prescribed — so the app can give
// concrete "do this next time" feedback instead of just a TSS number.
//
// Every number here is computed deterministically from the watts stream + the
// user's FTP. The coaching copy only ever narrates these computed facts.

import { parseLeadingMinutes } from './trainingLoad'

// Upper bound of each zone as a fraction of FTP (Coggan-style, aligned to the
// app's ZONE_IF midpoints). A sample lands in the first zone it doesn't exceed.
const ZONE_BOUNDS = [
  ['z1', 0.55],
  ['z2', 0.75],
  ['z3', 0.90],
  ['z4', 1.05],
  ['z5', Infinity],
]

export const ZONE_LABEL = { z1: 'recovery', z2: 'endurance', z3: 'sweet spot', z4: 'threshold', z5: 'VO₂' }

// Concrete "give it shape" prescription per structured zone.
const PRESCRIPTION = {
  z3: '2–3 × 15 min at 88–93% FTP',
  z4: '4 × 8 min at 95–105% FTP',
  z5: '5–6 × 3 min at 110–120% FTP',
}

function zoneOf(frac) {
  for (const [z, max] of ZONE_BOUNDS) if (frac <= max) return z
  return 'z5'
}

// Seconds each downsampled watts sample represents. Strava's stored streams are
// decimated, so we spread moving time evenly across the samples — an estimate,
// but a faithful one for time-in-zone.
function secPerSample(activity, n) {
  return (activity.moving_time_s || activity.elapsed_time_s || n) / n
}

// Minutes spent in each power zone, from the watts stream + FTP. Returns null
// when there's no power to read.
export function timeInZone(activity, ftp) {
  const watts = activity?.streams?.watts
  if (!watts?.length || !ftp) return null
  const sps = secPerSample(activity, watts.length)
  const sec = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  let coastingSec = 0
  for (const w of watts) {
    if (w == null) continue
    if (w <= 0) { coastingSec += sps; sec.z1 += sps; continue } // freewheeling
    sec[zoneOf(w / ftp)] += sps
  }
  const min = {}
  let total = 0
  for (const z of Object.keys(sec)) { min[z] = sec[z] / 60; total += sec[z] / 60 }
  return { min, totalMin: total, coastingPct: total ? (coastingSec / 60) / total : 0 }
}

// Distinct hard efforts: runs of ≥30s at ≥88% FTP (sweet-spot and up). This is
// the "did you actually do intervals, or just poot around" detector.
export function detectEfforts(activity, ftp) {
  const watts = activity?.streams?.watts
  if (!watts?.length || !ftp) return { count: 0, totalMin: 0 }
  const sps = secPerSample(activity, watts.length)
  const minSamples = Math.max(1, Math.round(30 / sps))
  let count = 0, totalSec = 0, run = 0
  const flush = () => { if (run >= minSamples) { count++; totalSec += run * sps } run = 0 }
  for (const w of watts) {
    if (w != null && w / ftp >= 0.88) run++
    else flush()
  }
  flush()
  return { count, totalMin: totalSec / 60 }
}

// Expected minutes *in the prescribed zone* for a session — not its total
// length, since warmup/recovery don't sit at the target. Drives shortfall maths
// both per-ride and across the week.
export function targetZoneMinutes(session) {
  if (!session || session.zone === 'rest') return 0
  const len = parseLeadingMinutes(session.desc) || 45
  const frac = { z1: 0.85, z2: 0.8, z3: 0.6, z4: 0.5, z5: 0.4 }[session.zone] ?? 0.6
  return Math.round(len * frac)
}

function dominantZone(min) {
  return Object.keys(min).reduce((a, b) => (min[b] > min[a] ? b : a), 'z1')
}
const r = m => Math.round(m)

// Per-ride coaching. Returns { tone, title, msg, tiz } or null when there's no
// power data to analyse. tone ∈ 'praise' | 'nudge' | 'note'.
export function analyzeRide(activity, session, ftp) {
  const tiz = timeInZone(activity, ftp)
  if (!tiz || tiz.totalMin < 5) return null
  const efforts = detectEfforts(activity, ftp)
  const dom = dominantZone(tiz.min)

  // Structured session prescribed (the high-value case).
  if (session && ['z3', 'z4', 'z5'].includes(session.zone)) {
    const tz = session.zone
    const inZone = tiz.min[tz] + (tz === 'z4' ? tiz.min.z5 : 0) // threshold credits VO₂ time too
    const target = targetZoneMinutes(session)
    if (inZone >= target * 0.7) {
      return { tone: 'praise', tiz,
        title: 'Target hit',
        msg: `${r(inZone)} min in ${tz.toUpperCase()} across ${efforts.count} effort${efforts.count === 1 ? '' : 's'}. Repeat this structure on ${ZONE_LABEL[tz]} days.` }
    }
    return { tone: 'nudge', tiz,
      title: 'Short on target zone',
      msg: `${r(inZone)} of ~${target} min in ${tz.toUpperCase()}${efforts.count ? '' : '; no efforts detected'}. Next ${ZONE_LABEL[tz]} day, ride ${PRESCRIPTION[tz]}.` }
  }

  // Easy day ridden too hard.
  if (session && ['z1', 'z2'].includes(session.zone)) {
    const hardMin = tiz.min.z3 + tiz.min.z4 + tiz.min.z5
    if (hardMin > tiz.totalMin * 0.25) {
      return { tone: 'nudge', tiz,
        title: 'Easy day ran hot',
        msg: `${r(hardMin)} min in Z3+ on an easy ${ZONE_LABEL[session.zone]} ride. Hold easy days below 75% FTP.` }
    }
    return { tone: 'praise', tiz,
      title: 'Endurance on target',
      msg: `${r(tiz.min.z1 + tiz.min.z2)} min aerobic, none in the red. Keep ${ZONE_LABEL[session.zone]} days here.` }
  }

  // Free ride, nothing prescribed.
  const coast = tiz.coastingPct > 0.25 ? ` ${r(tiz.coastingPct * 100)}% coasting — pedal through descents to hold steady load.` : ''
  const msg = (dom === 'z1' || dom === 'z2')
    ? `${r(tiz.totalMin)} min, mostly ${ZONE_LABEL[dom]}.${coast}`
    : `${r(tiz.totalMin)} min in mostly ${ZONE_LABEL[dom]}.${efforts.count ? ` ${efforts.count} effort${efforts.count === 1 ? '' : 's'} detected.` : ' Set a target zone before each ride.'}`
  return { tone: 'note', tiz, title: 'Ride logged', msg }
}

// Where a week's hard minutes lean, by event type. Endurance events sit mostly
// in sweet-spot/threshold; punchy events (crit, road) carry more VO₂. Fractions
// sum to 1 across z3/z4/z5.
const EVENT_HARD_MIX = {
  gran_fondo: { z3: 0.50, z4: 0.30, z5: 0.20 },
  sportive:   { z3: 0.55, z4: 0.25, z5: 0.20 },
  time_trial: { z3: 0.25, z4: 0.50, z5: 0.25 },
  road_race:  { z3: 0.20, z4: 0.40, z5: 0.40 },
  criterium:  { z3: 0.10, z4: 0.40, z5: 0.50 },
  other:      { z3: 0.35, z4: 0.35, z5: 0.30 },
}

// Assumed weekly hard-zone minutes when nothing is prescribed — a fallback so the
// coach bars always have a goal. Scales total intensity with fitness (CTL ≈ avg
// daily TSS) and splits it by what the next event demands.
export function assumedHardTargets(ctl, eventType) {
  const mix = EVENT_HARD_MIX[eventType] || EVENT_HARD_MIX.other
  const totalHard = Math.min(140, Math.max(40, Math.round((ctl || 40) * 1.4)))
  return {
    z3: Math.round(totalHard * mix.z3),
    z4: Math.round(totalHard * mix.z4),
    z5: Math.round(totalHard * mix.z5),
  }
}

// ── Rolling 7-day coach ──────────────────────────────────────
// Reads the *trailing 7 days* of actual riding against what was planned over
// the same window and suggests a tweak. A rolling window (rather than the
// calendar week) avoids the Monday reset that made every fresh week look like a
// deficit, and reflects your true recent training. `planned`: session objects
// scheduled in the window; `rides`: activities in the window. Returns
// { tone, title, msg, bars } or null when there's nothing to coach toward.
export function analyzeRolling7(planned, rides, ftp, upcoming = [], ctx = {}) {
  const prescribed = { z3: 0, z4: 0, z5: 0 }
  const actual = { z3: 0, z4: 0, z5: 0 }
  ;(planned || []).forEach(s => { if (s && prescribed[s.zone] != null) prescribed[s.zone] += targetZoneMinutes(s) })
  ;(rides || []).forEach(a => {
    const tiz = timeInZone(a, ftp)
    if (tiz) ['z3', 'z4', 'z5'].forEach(z => { actual[z] += tiz.min[z] })
  })

  const totalPrescribed = prescribed.z3 + prescribed.z4 + prescribed.z5
  const totalActual = actual.z3 + actual.z4 + actual.z5
  if (totalPrescribed < 5 && totalActual < 5) return null // nothing to coach toward

  // Hard-zone minutes the *upcoming* 7 days prescribe. Used as the bar target
  // when the trailing window was easy, so each bar always shows a goal to aim
  // at (what the plan has you building toward), not just logged time.
  const prescribedFwd = { z3: 0, z4: 0, z5: 0 }
  ;(upcoming || []).forEach(s => {
    const z = s?.session?.zone
    if (prescribedFwd[z] != null) prescribedFwd[z] += targetZoneMinutes(s.session)
  })
  // Fallback: assume targets from fitness + event type when nothing's prescribed
  // in either window, so every hard zone shows a goal to aim at.
  const assumed = assumedHardTargets(ctx.ctl, ctx.eventType)
  let usedAssumed = false
  const goal = {}
  ;['z3', 'z4', 'z5'].forEach(z => {
    if (prescribed[z] > 0) goal[z] = prescribed[z]
    else if (prescribedFwd[z] > 0) goal[z] = prescribedFwd[z]
    else { goal[z] = assumed[z]; usedAssumed = true }
  })

  const bars = ['z3', 'z4', 'z5'].filter(z => goal[z] > 0 || actual[z] >= 5)
    .map(z => ({ zone: z, prescribed: r(goal[z]), actual: r(actual[z]) }))

  // No intensity in the trailing week. Point at the plan's next hard session
  // rather than guessing whether the user is building toward something.
  if (totalPrescribed < 5) {
    const nextHard = (upcoming || []).find(s => ['z3', 'z4', 'z5'].includes(s?.session?.zone))
    if (nextHard) {
      const day = nextHard.date instanceof Date
        ? nextHard.date.toLocaleDateString('en-AU', { weekday: 'long' })
        : 'soon'
      return { tone: 'note', title: 'Easy stretch', bars, assumed: usedAssumed,
        msg: `Next hard session: ${ZONE_LABEL[nextHard.session.zone]} on ${day}. Stay fresh for it.` }
    }
    return { tone: 'note', title: 'Base block', bars, assumed: usedAssumed,
      msg: `No intensity in your plan right now — keep building aerobic base.` }
  }

  // Biggest shortfall (under-delivering the hard work), hardest zone winning ties.
  let deficit = null
  for (const z of ['z5', 'z4', 'z3']) {
    const gap = prescribed[z] - actual[z]
    if (prescribed[z] > 0 && gap > 10 && (!deficit || gap > deficit.gap)) deficit = { zone: z, gap }
  }
  // Overcooking a planned hard zone (well over its target) — a fatigue flag.
  let surplus = null
  for (const z of ['z5', 'z4']) {
    const over = actual[z] - prescribed[z]
    if (prescribed[z] > 0 && over > 15 && (!surplus || over > surplus.over)) surplus = { zone: z, over }
  }

  if (deficit) {
    return { tone: 'nudge', title: `Down on ${deficit.zone.toUpperCase()}`, bars, assumed: usedAssumed,
      msg: `Focus next on ${ZONE_LABEL[deficit.zone]} — ${r(deficit.gap)} min short this week.` }
  }
  if (surplus) {
    return { tone: 'nudge', title: `Heavy on ${surplus.zone.toUpperCase()}`, bars, assumed: usedAssumed,
      msg: `Ease off ${ZONE_LABEL[surplus.zone]} — ${r(surplus.over)} min over. Recover first.` }
  }
  return { tone: 'praise', title: 'On plan', bars, assumed: usedAssumed,
    msg: `On plan — hold the rhythm.` }
}
