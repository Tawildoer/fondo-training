// Shows the metrics + a power/HR graph for a Strava activity matched to a session.

import { plannedLoad, estActivityTSS, parseLeadingMinutes } from '../lib/trainingLoad'

function fmtDuration(s) {
  if (!s) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

function downsample(arr, max = 240) {
  if (!arr || arr.length <= max) return arr || []
  const step = arr.length / max
  const out = []
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)])
  return out
}

function linePath(values, W, H, pad) {
  const valid = values.filter(v => v != null)
  if (!valid.length) return ''
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  const range = (max - min) || 1
  const n = values.length
  return values.map((v, i) => {
    const x = (i / (n - 1)) * W
    const y = pad + (1 - ((v ?? min) - min) / range) * (H - 2 * pad)
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

function StreamGraph({ streams }) {
  const watts = downsample(streams?.watts)
  const hr = downsample(streams?.heartrate)
  if (!watts.length && !hr.length) return null

  const W = 320, H = 72, pad = 4
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', marginTop: 10 }} preserveAspectRatio="none">
      {watts.length > 0 && (
        <path d={linePath(watts, W, H, pad)} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round" />
      )}
      {hr.length > 0 && (
        <path d={linePath(hr, W, H, pad)} fill="none" stroke="var(--color-red)" strokeWidth="1.5" strokeLinejoin="round" opacity="0.8" />
      )}
    </svg>
  )
}

function Metric({ label, value }) {
  return (
    <div style={{ minWidth: 64 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  )
}

// One planned → actual row with a coloured delta.
function CompareRow({ label, planned, actual, unit }) {
  const pct = planned > 0 ? Math.round(((actual - planned) / planned) * 100) : null
  const color = pct === null ? 'var(--color-text-muted)'
    : Math.abs(pct) <= 15 ? 'var(--color-green-text)'
    : pct > 0 ? 'var(--color-amber-text)' : 'var(--color-text-muted)'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12 }}>
      <span style={{ width: 58, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{planned}{unit}</span>
      <i className="ti ti-arrow-right" style={{ fontSize: 11, opacity: 0.5 }} aria-hidden="true" />
      <span style={{ fontWeight: 600 }}>{actual}{unit}</span>
      {pct !== null && (
        <span style={{ fontSize: 11, fontWeight: 600, color }}>{pct > 0 ? '+' : ''}{pct}%</span>
      )}
    </div>
  )
}

function PlannedVsActual({ session, activity, ftp, maxHr }) {
  const plannedTSS = plannedLoad(session)
  if (!plannedTSS) return null
  const actualTSS = estActivityTSS(activity, ftp, maxHr)
  const plannedMin = Math.round(parseLeadingMinutes(session.desc) || 45)
  const actualMin = Math.round((activity.moving_time_s || 0) / 60)

  const loadPct = Math.round(((actualTSS - plannedTSS) / plannedTSS) * 100)
  const verdict = Math.abs(loadPct) <= 15
    ? { label: 'On target', color: 'var(--color-green-text)', bg: 'var(--color-green-light)' }
    : loadPct > 0
      ? { label: 'Harder than planned', color: 'var(--color-amber-text)', bg: 'var(--color-amber-light)' }
      : { label: 'Easier / shorter', color: 'var(--color-text-muted)', bg: 'var(--color-surface2)' }

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)' }}>Planned vs actual</span>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: verdict.bg, color: verdict.color }}>{verdict.label}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <CompareRow label="Duration" planned={plannedMin} actual={actualMin} unit=" min" />
        <CompareRow label="Load" planned={plannedTSS} actual={actualTSS} unit=" TSS" />
      </div>
    </div>
  )
}

export default function ActivityDetail({ activity, session, ftp, maxHr }) {
  if (!activity) return null
  const km = activity.distance_m ? (activity.distance_m / 1000).toFixed(1) : null
  const hasStreams = activity.streams && (activity.streams.watts || activity.streams.heartrate)

  const metrics = [
    km && { label: 'Distance', value: `${km} km` },
    activity.moving_time_s && { label: 'Time', value: fmtDuration(activity.moving_time_s) },
    activity.avg_watts && { label: 'Avg power', value: `${Math.round(activity.avg_watts)}W` },
    activity.weighted_avg_watts && { label: 'NP', value: `${Math.round(activity.weighted_avg_watts)}W` },
    activity.avg_hr && { label: 'Avg HR', value: `${Math.round(activity.avg_hr)}` },
    activity.total_elevation_m && { label: 'Elev', value: `${Math.round(activity.total_elevation_m)}m` },
  ].filter(Boolean)

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid rgba(0,0,0,0.1)' }}>
      {session && <PlannedVsActual session={session} activity={activity} ftp={ftp} maxHr={maxHr} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: session ? 10 : 0 }}>
        <i className="ti ti-brand-strava" style={{ fontSize: 14, color: '#FC4C02' }} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{activity.name || 'Strava ride'}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {metrics.map(m => <Metric key={m.label} label={m.label} value={m.value} />)}
      </div>
      {hasStreams && (
        <>
          <StreamGraph streams={activity.streams} />
          <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
            {activity.streams.watts && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 2, background: 'var(--color-accent)', display: 'inline-block' }} /> Power
              </span>
            )}
            {activity.streams.heartrate && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 2, background: 'var(--color-red)', display: 'inline-block' }} /> Heart rate
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
