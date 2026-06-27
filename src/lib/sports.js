// ── Sport primitive ──────────────────────────────────────────
// The app started bike-only; multi-sport adds running, swimming and triathlon.
// A session's discipline lives in its `sport` field — and every session saved
// before this existed has no `sport`, so the whole app treats a missing value
// as 'bike'. Keep that default sacred: it's what makes old plans keep working.

export const SPORTS = {
  bike:  { label: 'Bike',  icon: 'ti-bike',         unit: 'power' },   // watts off FTP
  run:   { label: 'Run',   icon: 'ti-run',          unit: 'pace' },    // sec / km off threshold pace
  swim:  { label: 'Swim',  icon: 'ti-swimming',     unit: 'pace100' }, // sec / 100m off CSS
  brick: { label: 'Brick', icon: 'ti-arrows-split', unit: 'mixed' },   // bike → run, back-to-back
}

// The discipline a session belongs to, defaulting to bike for anything saved
// before sport existed (or a plain rest day).
export function sessionSport(session) {
  return session?.sport || 'bike'
}

export function sportMeta(sport) {
  return SPORTS[sport] || SPORTS.bike
}

// True for the disciplines that aren't a single steady-state bike effort —
// used to gate power-only behaviour (.zwo export, FTP-watt targets, the power
// rider radar) the same way the strength session type is gated.
export function isBikeWorkout(session) {
  return sessionSport(session) === 'bike' && session?.zone !== 'strength'
}

// ── Event → sport ────────────────────────────────────────────
// Which broad discipline an event periodizes toward. Triathlon is its own
// thing because its weeks mix all three single-sport disciplines.
const EVENT_SPORT = {
  // cycling
  gran_fondo: 'bike', sportive: 'bike', road_race: 'bike',
  criterium: 'bike', time_trial: 'bike', other: 'bike',
  // running
  running: 'run',
  // triathlon (distance encoded in the type so no schema change is needed)
  tri_sprint: 'tri', tri_olympic: 'tri', tri_70_3: 'tri', tri_ironman: 'tri',
}

export function eventSport(eventType) {
  return EVENT_SPORT[eventType] || 'bike'
}

// A triathlon week draws from all three; everything else is single-sport.
export function isMultiSport(sport) {
  return sport === 'tri'
}

// The single-sport disciplines a goal sport schedules. Bike/run events stay in
// their lane; a triathlon spreads across swim/bike/run.
export function disciplinesFor(sport) {
  if (sport === 'tri') return ['swim', 'bike', 'run']
  if (sport === 'run') return ['run']
  return ['bike']
}
