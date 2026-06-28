// ── Auto-rebalance on bail ───────────────────────────────────
// A bailed session shouldn't quietly shrink the week. When you bail, recoup its
// training load across the rest of the week — and spill the remainder into next
// week — WITHOUT cooking the back half. Pure + deterministic so it can be
// recomputed and reversed safely.
//
// Priority: (A) preserve the *quality* by moving a hard session intact onto a
// clear later rest day; else (B) recoup the *load* as endurance volume on the
// remaining days, capped by a per-day ceiling and spacing; else (C) spill to
// next week. Anything that still won't fit is reported as unrecoverable.

import { tssFor, buildSession, brickTss, multiTss } from './weeklyPlanner'
import { getSessionDate, DAY_OFFSETS } from './schedule'

const HARD = new Set(['z3', 'z4', 'z5'])
const ENDURANCE = new Set(['z1', 'z2'])
const LONG_MIN = 120          // an endurance ride this long counts as a demanding day
const EASY_CAP_MIN = 105      // a day next to a demanding one stays at most this easy

// Minutes embedded in a session, preferring the stored field, falling back to
// the leading number in its description (mirrors weekTss).
function sessionMinutes(s) {
  if (s?.durationMin != null) return s.durationMin
  const m = s?.desc?.match(/^(\d+(?:\.\d+)?)\s*(hr|hrs|hour|hours|min|mins|minutes)/i)
  return m ? (m[2][0].toLowerCase() === 'h' ? +m[1] * 60 : +m[1]) : 0
}

function sessionTss(s) {
  if (!s || s.zone === 'rest' || s.zone === 'strength') return 0
  if (s.sport === 'brick') return brickTss(s)
  if (s.sport === 'multi') return multiTss(s)
  return tssFor(s.zone, sessionMinutes(s))
}

// tssFor is linear in minutes, so invert it to size a top-up.
function minutesForTss(zone, tss) {
  const perMin = tssFor(zone, 60) / 60
  return perMin > 0 ? tss / perMin : 0
}

const dayIdx = s => DAY_OFFSETS[s.day] ?? 99
const shortName = s =>
  s.zone === 'z4' ? 'threshold' : s.zone === 'z3' ? 'sweet spot' : s.zone === 'z5' ? 'VO₂'
    : (s.name || 'session').toLowerCase()

// A day that needs a rest buffer around it: a hard session OR a long endurance
// ride. Treating the long ride as "demanding" is what stops us stacking a
// threshold the day before it.
const isDemanding = s =>
  !!s && (HARD.has(s.zone) || (ENDURANCE.has(s.zone) && (s.name === 'Long ride' || sessionMinutes(s) >= LONG_MIN)))

// Turn candidate slots into absorbers with a per-day cap: a slot sitting next
// to a demanding day stays easy (so we never create a second demanding day
// back-to-back); others may grow up to the week's hardest single session.
// Existing endurance days fill before rest days are converted, preserving rest.
function cappedAbsorbers(sessions, candidates, perDayCeiling, ftp) {
  const demand = new Set(sessions.filter(isDemanding).map(dayIdx))
  const easyCap = tssFor('z2', EASY_CAP_MIN)
  return candidates
    .map(o => {
      const d = dayIdx(o.s)
      const adjacent = demand.has(d - 1) || demand.has(d + 1)
      return { ...o, cap: adjacent ? Math.min(perDayCeiling, easyCap) : perDayCeiling }
    })
    .sort((a, b) => (a.s.zone === 'rest' ? 1 : 0) - (b.s.zone === 'rest' ? 1 : 0) || ((a.date || 0) - (b.date || 0)))
}

// Pour `need` TSS of endurance volume into absorber slots, each capped by its
// own `cap`. Mutates `sessions` in place; returns { placed, moves }.
function pourVolume(sessions, absorbers, need, ftp) {
  let left = need
  const moves = []
  for (const o of absorbers) {
    if (left <= 0) break
    const cur = sessionTss(o.s)
    const headroom = Math.max(0, o.cap - cur)
    if (headroom <= 0) continue
    const add = Math.min(left, headroom)
    const zone = o.s.zone === 'rest' ? 'z2' : o.s.zone
    const baseMin = o.s.zone === 'rest' ? 0 : sessionMinutes(o.s)
    const newMin = baseMin + minutesForTss(zone, add)
    const isLong = o.s.name === 'Long ride'
    const rebuilt = buildSession(o.s.day, zone, newMin, ftp, isLong)
    const placed = sessionTss(rebuilt) - cur
    if (placed <= 0) continue
    sessions[o.i] = rebuilt
    left -= placed
    moves.push(`+${Math.round(minutesForTss(zone, placed))} min Z${zone.slice(1)} ${o.s.day}`)
  }
  return { placed: need - Math.max(0, left), moves }
}

export function rebalanceForBail({ week, nextWeek, bailedIdx, planStart, ftp, today = new Date() }) {
  const sessions = (week?.sessions || []).map(s => ({ ...s }))
  const bailed = sessions[bailedIdx]
  // Strength carries no cycling load — bailing one needs no ride rebalance.
  // Strength, brick and two-a-day sessions don't drive the cycling rebalance.
  if (!bailed || bailed.zone === 'rest' || bailed.zone === 'strength' || bailed.sport === 'brick' || bailed.sport === 'multi') return null
  const deficit = sessionTss(bailed)
  if (deficit <= 0) return null

  const t0 = new Date(today); t0.setHours(0, 0, 0, 0)
  const perDayCeiling = Math.max(...sessions.map(sessionTss))

  // Slots still ahead of today (and not the bailed one itself).
  const future = sessions
    .map((s, i) => ({ s, i, date: getSessionDate(week.num, s, i, planStart) }))
    .filter(o => o.date.getTime() > t0.getTime() && o.i !== bailedIdx)
    .sort((a, b) => a.date - b.date)

  // ── A. Preserve quality: move the hard session onto a clear future rest day ──
  if (HARD.has(bailed.zone)) {
    // A rest day is only "clear" if neither neighbour is demanding — and a long
    // ride counts as demanding, so we won't sit a threshold the day before it.
    const demandDays = new Set(sessions.filter(isDemanding).map(dayIdx))
    const clear = future.find(o => {
      if (o.s.zone !== 'rest') return false
      const d = dayIdx(o.s)
      return !demandDays.has(d - 1) && !demandDays.has(d + 1) // keep a rest buffer
    })
    if (clear) {
      sessions[clear.i] = buildSession(clear.s.day, bailed.zone, sessionMinutes(bailed), ftp)
      return {
        week: sessions, nextWeek: null, nextWeekExists: !!nextWeek, carryTss: 0,
        summary: `Missed ${bailed.day} ${shortName(bailed)} → moved to ${clear.s.day}`,
      }
    }
  }

  // ── B. Recoup as endurance volume on the remaining days ──
  const candidates = future.filter(o => ENDURANCE.has(o.s.zone) || o.s.zone === 'rest')
  const absorbers = cappedAbsorbers(sessions, candidates, perDayCeiling, ftp)
  const thisWeek = pourVolume(sessions, absorbers, deficit, ftp)
  let remaining = deficit - thisWeek.placed
  const moves = [...thisWeek.moves]

  // ── C. Spill the remainder into next week (within a safe ramp) ──
  let nextSessions = null
  if (remaining > 1 && nextWeek?.sessions?.length) {
    const ns = nextWeek.sessions.map(s => ({ ...s }))
    const nCeiling = Math.max(...ns.map(sessionTss))
    const rampCap = Math.round((nextWeek.target_tss || 0) * 0.15) || remaining
    const want = Math.min(remaining, rampCap)
    const nCands = ns.map((s, i) => ({ s, i })).filter(o => ENDURANCE.has(o.s.zone) || o.s.zone === 'rest')
    const nAbs = cappedAbsorbers(ns, nCands, nCeiling, ftp)
    const spilled = pourVolume(ns, nAbs, want, ftp)
    if (spilled.placed > 1) {
      nextSessions = ns
      remaining -= spilled.placed
      moves.push(`+${Math.round(spilled.placed)} TSS next week`)
    }
  }

  const carryTss = Math.max(0, Math.round(remaining))
  const lost = carryTss > 3 ? ` · ${carryTss} TSS couldn't be recovered` : ''
  const tail = moves.length ? moves.join(', ') : 'no room left this week'
  return {
    week: sessions,
    nextWeek: nextSessions,
    nextWeekExists: !!nextWeek,
    carryTss, // persist as the previous week's carry-out when next week isn't planned yet
    summary: `Missed ${bailed.day} ${shortName(bailed)} → ${tail}${lost}`,
  }
}
