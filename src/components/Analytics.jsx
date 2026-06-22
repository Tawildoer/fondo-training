// Analytics — the data hub. Hosts the deeper charts (fitness trajectory,
// training load) plus FTP and the power/HR zone reference. The Overview stays
// at-a-glance; everything data-oriented lives here.

import { useMemo } from 'react'
import { computeTrainingLoad } from '../lib/trainingLoad'
import { projectLoad } from '../lib/weeklyPlanner'
import { parseLocalDate } from '../lib/schedule'
import PowerZones from './PowerZones'

function ProjectionChart({ series, events }) {
  if (!series || series.length < 2) return null
  const W = 320, H = 150, padL = 6, padR = 6, padT = 18, padB = 22
  const n = series.length
  const maxY = Math.max(1, ...series.map(s => s.ctl))
  const xAt = i => (n === 1 ? W / 2 : padL + (i / (n - 1)) * (W - padL - padR))
  const yAt = v => padT + (1 - v / maxY) * (H - padT - padB)
  const seg = (from, to) => series.slice(from, to + 1).map((s, k) => `${k === 0 ? 'M' : 'L'} ${xAt(from + k).toFixed(1)} ${yAt(s.ctl).toFixed(1)}`).join(' ')
  const lastPlanned = series.reduce((acc, s, i) => (s.planned ? i : acc), -1)
  const solidPath = lastPlanned >= 1 ? seg(0, lastPlanned) : ''
  const dashedPath = seg(Math.max(0, lastPlanned), n - 1)
  const areaPath = `${seg(0, n - 1)} L ${xAt(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${xAt(0).toFixed(1)} ${(H - padB).toFixed(1)} Z`
  const start = series[0].ctl
  const peak = Math.max(...series.map(s => s.ctl))
  const fmt = d => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const markers = (events || []).map(e => {
    const d = parseLocalDate(e.date)
    if (!d) return null
    const idx = series.findIndex(s => s.date.toDateString() === d.toDateString())
    return idx < 0 ? null : { x: xAt(idx), name: e.name || 'Event' }
  }).filter(Boolean)

  return (
    <div className="card wgt-3">
      <h2>Fitness trajectory</h2>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
        <span>Now <strong style={{ color: 'var(--color-text)' }}>{start} CTL</strong></span>
        <span>Projected peak <strong style={{ color: 'var(--color-accent-text)' }}>{peak} CTL</strong></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="projFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#projFill)" stroke="none" />
        {markers.map((m, i) => (
          <g key={i}>
            <line x1={m.x} x2={m.x} y1={padT} y2={H - padB} stroke="var(--color-electric)" strokeWidth="1" strokeDasharray="2 2" opacity="0.8" />
            <text x={m.x} y={12} textAnchor="middle" fontSize="10"><title>{m.name}</title>🏁</text>
          </g>
        ))}
        {solidPath && <path d={solidPath} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        <path d={dashedPath} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={lastPlanned >= 0 ? '4 3' : '0'} opacity={lastPlanned >= 0 ? 0.85 : 1} />
        <text x={padL} y={H - 4} textAnchor="start" fontSize="8" fill="var(--color-text-faint)">{fmt(series[0].date)}</text>
        <text x={W - padR} y={H - 4} textAnchor="end" fontSize="8" fill="var(--color-text-faint)">{fmt(series[n - 1].date)}</text>
      </svg>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, height: 2, background: 'var(--color-accent)', display: 'inline-block' }} /> Planned</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 14, borderTop: '2px dashed var(--color-accent)', display: 'inline-block' }} /> Projected</span>
        {markers.length > 0 && <span>🏁 event</span>}
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
        Where your fitness heads if you keep planning toward your {events?.length ? 'events' : 'goal'} — locked weeks solid, future weeks estimated.
      </p>
    </div>
  )
}

function formMeta(tsb) {
  if (tsb > 8) return { label: 'Fresh', color: 'var(--color-green-text)', bg: 'var(--color-green-light)' }
  if (tsb < -15) return { label: 'Fatigued', color: 'var(--color-red-text)', bg: 'var(--color-red-light)' }
  return { label: 'Balanced', color: 'var(--color-accent-text)', bg: 'var(--color-accent-light)' }
}

function TrainingLoadCard({ plan, sessionState, activities, user, planStart }) {
  const { series, current, hasData, fromRides } = useMemo(
    () => computeTrainingLoad(plan, sessionState, activities, user, planStart),
    [plan, sessionState, activities, user, planStart]
  )

  if (!hasData) {
    return (
      <div className="card wgt-3">
        <h2>Training load</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          Complete a few sessions (or sync some rides) and your fitness, fatigue and form
          curves will build here.
        </p>
      </div>
    )
  }

  const W = 320, H = 140, padL = 6, padR = 6, padT = 14, padB = 20
  const n = series.length
  const maxY = Math.max(1, ...series.map(s => Math.max(s.ctl, s.atl)))
  const xAt = i => n === 1 ? W / 2 : padL + (i / (n - 1)) * (W - padL - padR)
  const yAt = v => padT + (1 - v / maxY) * (H - padT - padB)
  const pathFor = key => series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(s[key]).toFixed(1)}`).join(' ')
  const areaFor = key => {
    if (!n) return ''
    const baseY = (H - padB).toFixed(1)
    return `${pathFor(key)} L ${xAt(n - 1).toFixed(1)} ${baseY} L ${xAt(0).toFixed(1)} ${baseY} Z`
  }
  const fmt = d => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const form = formMeta(current.tsb)

  return (
    <div className="card wgt-3">
      <h2>Training load</h2>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-accent-text)' }}>{current.ctl}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fitness (CTL)</div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--color-amber-text)' }}>{current.atl}</div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fatigue (ATL)</div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700, letterSpacing: '-0.03em' }}>{current.tsb > 0 ? '+' : ''}{current.tsb}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: form.bg, color: form.color }}>{form.label}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Form (TSB)</div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaFor('ctl')} fill="url(#ctlFill)" stroke="none" />
        <path d={pathFor('ctl')} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathFor('atl')} fill="none" stroke="var(--color-amber-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" />
        {n > 0 && (
          <>
            <text x={padL} y={H - 4} textAnchor="start" fontSize="8" fill="var(--color-text-faint)">{fmt(series[0].date)}</text>
            <text x={W - padR} y={H - 4} textAnchor="end" fontSize="8" fill="var(--color-text-faint)">{fmt(series[n - 1].date)}</text>
          </>
        )}
      </svg>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}>
          <span style={{ width: 14, height: 2, background: 'var(--color-accent)', display: 'inline-block' }} /> Fitness
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}>
          <span style={{ width: 14, height: 2, background: 'var(--color-amber-text)', display: 'inline-block' }} /> Fatigue
        </span>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 8, lineHeight: 1.5 }}>
        {fromRides
          ? 'From your synced rides (power or HR based), estimated from planned zones on days without a ride.'
          : 'Estimated from planned zones + your RPE — sync rides for power-based accuracy.'}
      </p>
    </div>
  )
}

export default function Analytics({ user, onUpdateFTP, ftpHistory = [], plan, sessionState = {}, planStart, activities = [], events = [], loadCtx, plannedWeeks = [], realCurrentWeek = 1 }) {
  const projection = useMemo(() => projectLoad({
    currentCtl: loadCtx?.currentCtl || 0,
    recentWeeklyTss: loadCtx?.recentWeeklyTss || 0,
    planStart, currentWeekNum: realCurrentWeek, events, user, plannedWeeks,
  }), [loadCtx, planStart, realCurrentWeek, events, user, plannedWeeks])

  return (
    <div>
      <div className="ov-cols">
        <TrainingLoadCard plan={plan} sessionState={sessionState} activities={activities} user={user} planStart={planStart} />
        <ProjectionChart series={projection} events={events} />
      </div>
      <PowerZones user={user} onUpdateFTP={onUpdateFTP} ftpHistory={ftpHistory} />
    </div>
  )
}
