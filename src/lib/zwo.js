// ── Zwift .zwo export ────────────────────────────────────────
// Turn a planned session into a Zwift custom-workout file. Zwift has no public
// API to push workouts, but a `.zwo` placed in its Workouts folder syncs to the
// cloud and appears under Custom Workouts on every device. We already model the
// interval structure in `buildWorkout` (segments of { kind, min, pct } where pct
// is a fraction of FTP) — that maps onto the .zwo schema almost 1:1.

import { buildWorkout } from './weeklyPlanner'

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const secs = min => Math.max(1, Math.round(min * 60))
const pwr = p => (Math.round(p * 1000) / 1000).toString()

// One <workout> child per segment. Warmup/cooldown are ramps; the work, recover
// and steady blocks hold their target (% of FTP) flat.
function segmentXml(seg) {
  const d = secs(seg.min)
  switch (seg.kind) {
    case 'warmup':   return `    <Warmup Duration="${d}" PowerLow="0.45" PowerHigh="${pwr(Math.max(seg.pct, 0.7))}"/>`
    case 'cooldown': return `    <Cooldown Duration="${d}" PowerLow="${pwr(Math.max(seg.pct, 0.55))}" PowerHigh="0.35"/>`
    default:         return `    <SteadyState Duration="${d}" Power="${pwr(seg.pct)}"/>` // work | recover | steady
  }
}

// Stable filename so a re-sync overwrites the same workout instead of piling up
// duplicates. The human-readable label lives in <name> inside the file.
export function zwoFilename(weekNum, idx) {
  return `wattsToCome-w${weekNum}-s${idx}.zwo`
}

// `dateLabel` is an optional short prefix for the in-Zwift name (e.g. "Fri 26 Jun").
export function buildZwo(session, ftp, dateLabel = '') {
  // Only bike workouts export to Zwift (rest, strength, run, swim, brick don't).
  const sport = session?.sport || 'bike'
  if (!session || session.zone === 'rest' || session.zone === 'strength' || sport !== 'bike' || !ftp) return null
  const wk = buildWorkout(session.zone, session.durationMin, ftp)
  const title = `${dateLabel ? dateLabel + ' · ' : ''}${session.name}${wk.summary ? ` (${wk.summary})` : ''}`
  const body = (wk.segments || []).map(segmentXml).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>wattsToCome</author>
  <name>${esc(title)}</name>
  <description>${esc(session.desc || '')}</description>
  <sportType>bike</sportType>
  <tags><tag name="wattsToCome"/></tags>
  <workout>
${body}
  </workout>
</workout_file>
`
}
