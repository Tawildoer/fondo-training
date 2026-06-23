// ── Rider profile ────────────────────────────────────────────
// Turns your accumulated rides into a power-duration "fingerprint" and scores
// each ability against a balanced all-rounder, so the radar reads as strengths
// and weaknesses. No body weight on file → everything is normalised to FTP,
// which makes this about rider *type* rather than absolute watts.
//
// Caveat: Strava streams are downsampled, so very short efforts (sprint) are
// approximate; 1-min and longer are reliable.

// Each ability: a duration (seconds) and the power-to-FTP ratio that scores ~50
// (balanced) and ~85 (strong). Ordered as they sit around the radar.
const ABILITIES = [
  { key: 'sprint',    label: 'Sprint',    window: '10s',   sec: 10,   ref50: 2.20, ref85: 2.90, estimate: true },
  { key: 'anaerobic', label: 'Anaerobic', window: '1 min', sec: 60,   ref50: 1.45, ref85: 1.78 },
  { key: 'vo2',       label: 'VO₂max',    window: '5 min', sec: 300,  ref50: 1.15, ref85: 1.32 },
  { key: 'threshold', label: 'Threshold', window: '20 min', sec: 1200, ref50: 1.00, ref85: 1.08, floorFtp: true },
]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const r0 = v => Math.round(v)

// Best rolling-average power over a `sec`-long window, accounting for the
// stream's (downsampled) sample interval. null if the ride is too short.
export function meanMaximalPower(activity, sec) {
  const watts = activity?.streams?.watts
  if (!watts?.length) return null
  const total = activity.moving_time_s || activity.elapsed_time_s || watts.length
  const sps = total / watts.length            // seconds each sample represents
  const win = Math.max(1, Math.round(sec / sps))
  if (win > watts.length) return null
  const v = i => (watts[i] != null && watts[i] > 0 ? watts[i] : 0)
  let sum = 0
  for (let i = 0; i < win; i++) sum += v(i)
  let best = sum
  for (let i = win; i < watts.length; i++) { sum += v(i) - v(i - win); if (sum > best) best = sum }
  return best / win
}

function scoreFor(ratio, a) {
  return clamp(r0(50 + ((ratio - a.ref50) / (a.ref85 - a.ref50)) * 35), 8, 100)
}

// Endurance = aerobic base: scaled from fitness (CTL) with a small bump for
// proven long rides. CTL 45 ≈ 50, CTL 95 ≈ 90.
function enduranceScore(ctl, longestSec) {
  let s = 50 + (((ctl || 0) - 45) / 50) * 40
  if (longestSec >= 3 * 3600) s += 8
  else if (longestSec >= 2 * 3600) s += 4
  return clamp(r0(s), 8, 100)
}

// Build the full profile. Returns { axes, rides, strength, limiter } or null
// when there isn't enough power data to say anything useful.
export function buildRiderProfile(activities, ftp, { ctl = 0 } = {}) {
  const rides = (activities || []).filter(a => a?.streams?.watts?.length)
  if (!ftp || rides.length < 2) return null

  const axes = ABILITIES.map(a => {
    let bestW = 0
    for (const act of rides) {
      const mmp = meanMaximalPower(act, a.sec)
      if (mmp != null && mmp > bestW) bestW = mmp
    }
    // Threshold can't read below FTP — that's its definition.
    if (a.floorFtp) bestW = Math.max(bestW, ftp)
    const hasData = bestW > 0
    const ratio = hasData ? bestW / ftp : 0
    return {
      key: a.key, label: a.label, window: a.window, sec: a.sec, estimate: !!a.estimate,
      value: r0(bestW), unit: 'W', ratio, hasData,
      score: hasData ? scoreFor(ratio, a) : 0,
    }
  })

  const longest = Math.max(0, ...rides.map(a => a.moving_time_s || 0))
  axes.push({
    key: 'endurance', label: 'Endurance', window: 'aerobic base', value: r0(ctl), unit: 'CTL',
    hasData: (ctl || 0) > 0 || longest > 0, score: enduranceScore(ctl, longest),
  })

  const ranked = axes.filter(a => a.hasData).sort((a, b) => b.score - a.score)
  return {
    axes,
    rides: rides.length,
    strength: ranked[0] || null,
    limiter: ranked.length > 1 ? ranked[ranked.length - 1] : null,
  }
}
