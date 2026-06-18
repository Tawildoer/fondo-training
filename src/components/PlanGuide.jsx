import { ZONE_DEFINITIONS } from '../lib/planGenerator'

const PHASE_META = {
  base:      { label: 'Base aerobic',    tagClass: 'tag-base',     desc: 'Build your aerobic engine with controlled Z2 riding. No hard efforts — just volume and consistency.' },
  build:     { label: 'Threshold build', tagClass: 'tag-build',    desc: 'Introduce FTP intervals and sweet spot work. This is where fitness jumps. Tue and Thu become key quality sessions.' },
  'race-prep': { label: 'Race-specific', tagClass: 'tag-race-prep', desc: 'Sessions mirror your event demands. Longer threshold blocks for endurance events; short, sharp VO₂ efforts for crits and road races.' },
  taper:     { label: 'Taper',           tagClass: 'tag-taper',    desc: 'Volume drops, intensity stays. Short sharp sessions keep your legs firing while fatigue clears before race day.' },
}

const WEEK_TEMPLATE = [
  { day: 'Mon', role: 'Rest',               zone: 'rest', note: 'Full rest. Sleep and eat well.' },
  { day: 'Tue', role: 'Key quality session', zone: 'z4',  note: 'The hardest session of the week — FTP intervals, threshold blocks, or VO₂ efforts depending on your phase.' },
  { day: 'Wed', role: 'Recovery spin',       zone: 'z1',  note: '45 min easy. Keeps blood flowing without adding stress.' },
  { day: 'Thu', role: 'Secondary quality',   zone: 'z3',  note: 'Sweet spot or tempo work — harder than Z2 but not as taxing as Tuesday.' },
  { day: 'Fri', role: 'Rest',                zone: 'rest', note: 'Second rest day before the weekend block.' },
  { day: 'Sat', role: 'Long ride',            zone: 'z2',  note: 'Your biggest ride of the week. Volume and fuelling practice.' },
  { day: 'Sun', role: 'Easy spin',            zone: 'z1',  note: '45–60 min easy to flush the legs before the next week.' },
]

const ZONE_META = [
  { key: 'z1', label: 'Z1 — Recovery',    cssClass: 'sess-z1', pct: '< 55% FTP', feel: 'Barely working. You could hold a full conversation.' },
  { key: 'z2', label: 'Z2 — Endurance',   cssClass: 'sess-z2', pct: '56–75% FTP', feel: 'Comfortable and sustainable. The aerobic base zone.' },
  { key: 'z3', label: 'Z3 — Tempo',       cssClass: 'sess-z3', pct: '76–90% FTP', feel: 'Moderately hard. Talking is difficult.' },
  { key: 'z4', label: 'Z4 — Threshold',   cssClass: 'sess-z4', pct: '91–105% FTP', feel: 'Hard but controlled. This is race-winning fitness.' },
  { key: 'z5', label: 'Z5 — VO₂ max',    cssClass: 'sess-z5', pct: '106–120% FTP', feel: 'Very hard. Short efforts only. Used in race simulation.' },
]

function Section({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2>{title}</h2>
      {children}
    </div>
  )
}

function PhaseBar({ phases }) {
  const total = phases.reduce((s, p) => s + p.weeks, 0)
  return (
    <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', height: 28, marginBottom: '1rem' }}>
      {phases.map((p, i) => {
        const meta = PHASE_META[p.type] || {}
        return (
          <div key={i} style={{ flex: p.weeks / total, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className={`tag ${meta.tagClass}`} style={{ borderRadius: 0, width: '100%', textAlign: 'center', padding: '4px 6px', fontSize: 10 }}>
              {meta.label} · {p.weeks}w
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function PlanGuide({ plan, user }) {
  // Derive phase summary from plan
  const phases = []
  plan.forEach(week => {
    if (week.isRecovery) return
    const last = phases[phases.length - 1]
    if (last && last.type === week.phase) {
      last.weeks++
    } else {
      phases.push({ type: week.phase, label: week.phaseLabel, weeks: 1 })
    }
  })

  const totalWeeks = plan.length
  const recoveryWeeks = plan.filter(w => w.isRecovery).length
  const daysPerWeek = user.days_per_week || 5

  return (
    <div>
      {/* Intro tip */}
      <div className="tip-box" style={{ marginBottom: '1.25rem' }}>
        <i className="ti ti-info-circle" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <span>
          Your {totalWeeks}-week plan was built from your event date, weekly hours, and training days.
          Everything below explains exactly how it's structured and why.
        </span>
      </div>

      {/* Phase overview */}
      <Section title="Plan structure">
        <PhaseBar phases={phases} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {phases.map((p, i) => {
            const meta = PHASE_META[p.type] || {}
            return (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className={`tag ${meta.tagClass}`} style={{ marginTop: 1, flexShrink: 0, minWidth: 60, textAlign: 'center' }}>
                  {p.weeks}w
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{meta.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>{meta.desc}</div>
                </div>
              </div>
            )
          })}
          {recoveryWeeks > 0 && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span className="tag tag-recovery" style={{ marginTop: 1, flexShrink: 0, minWidth: 60, textAlign: 'center' }}>
                {recoveryWeeks}w
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Recovery weeks</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
                  Automatically inserted every 4th week. Volume drops to ~75% so your body can absorb the training before the next block.
                </div>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Weekly structure */}
      <Section title="Weekly structure">
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: '0.85rem', lineHeight: 1.55 }}>
          Every week follows the same skeleton — rest, quality, recovery, quality, rest, long ride, easy.
          {daysPerWeek < 5 && ` With ${daysPerWeek} training days, Wednesday's recovery spin is removed to fit your schedule.`}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {WEEK_TEMPLATE.filter(d => {
            if (daysPerWeek >= 5) return true
            if (daysPerWeek === 4 && d.day === 'Wed') return false
            if (daysPerWeek === 3 && (d.day === 'Wed' || d.day === 'Thu')) return false
            return true
          }).map(d => (
            <div key={d.day} className={`sess-${d.zone}`}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 'var(--radius-sm)', padding: '9px 11px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6, width: 28, flexShrink: 0, paddingTop: 1 }}>
                {d.day}
              </span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 1 }}>{d.role}</div>
                <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.5 }}>{d.note}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Zones */}
      <Section title="Training zones">
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: '0.85rem', lineHeight: 1.55 }}>
          {user.ftp
            ? `Zones are calculated from your FTP of ${user.ftp}W. Sessions show exact watt targets based on these ranges.`
            : 'You haven\'t set an FTP yet — sessions show zone labels. Set your FTP in the Power Zones tab to unlock watt targets.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ZONE_META.map(z => {
            const ftpWatts = user.ftp
              ? (() => {
                  const def = ZONE_DEFINITIONS.find(d => d.z === z.key.replace('z', 'Z').replace('Z1', 'Z1').toUpperCase())
                  if (!def) return null
                  return `${Math.round(def.factors[0] * user.ftp)}–${Math.round(def.factors[1] * user.ftp)}W`
                })()
              : null
            return (
              <div key={z.key} className={z.cssClass}
                style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 'var(--radius-sm)', padding: '9px 11px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 1 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{z.label}</span>
                    <span style={{ fontSize: 11, opacity: 0.65 }}>{z.pct}</span>
                    {ftpWatts && <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>· {ftpWatts}</span>}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.5 }}>{z.feel}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Adaptive coaching */}
      <Section title="Adaptive coaching">
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
          After completing a session, you can log an RPE (Rate of Perceived Effort) score from 1–5.
          The app looks at your recent hard sessions and adjusts the coaching banner at the top of each week.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            { score: '1–2', label: 'Too easy', tone: 'go',      msg: 'Nudge up intensity — add watts or extend the last interval.' },
            { score: '3',   label: 'On target', tone: 'good',   msg: 'Training is landing well. Stay disciplined with the plan.' },
            { score: '4',   label: 'Hard',      tone: 'push',   msg: 'Feeling the load. Prioritise quality reps over grinding through fatigue.' },
            { score: '5',   label: 'Too much',  tone: 'warning', msg: 'Back off. Hit interval counts but don\'t chase extra watts.' },
          ].map(r => (
            <div key={r.score} className={`adaptive-banner ${r.tone}`} style={{ margin: 0 }}>
              <span style={{ fontWeight: 700, flexShrink: 0, width: 32 }}>RPE {r.score}</span>
              <span style={{ opacity: 0.75, marginRight: 6 }}>·</span>
              <span>{r.msg}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: '0.75rem', lineHeight: 1.5 }}>
          The banner only appears once you have RPE data from the previous two weeks of hard sessions.
        </p>
      </Section>
    </div>
  )
}
