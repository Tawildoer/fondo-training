import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js'
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

const PHASE_COLORS = { base: '#378ADD', build: '#639922', 'race-prep': '#534AB7', taper: '#EF9F27', recovery: '#888780' }

export default function Overview({ user, plan, doneSessions, totalSessions, daysLeft }) {
  const weeksLeft = daysLeft ? Math.ceil(daysLeft / 7) : null
  const pct = totalSessions ? Math.round((doneSessions / totalSessions) * 100) : 0

  const chartData = {
    labels: plan.map(w => `W${w.num}`),
    datasets: [{
      label: 'Hours',
      data: plan.map(w => w.hrs),
      backgroundColor: plan.map(w => PHASE_COLORS[w.phase] || '#888'),
      borderRadius: 4,
    }],
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y}h`, afterLabel: ctx => plan[ctx.dataIndex]?.label } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: { beginAtZero: true, ticks: { callback: v => v + 'h', font: { size: 11 } }, grid: { color: 'rgba(128,128,128,0.1)' } },
    },
  }

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card"><div className="val">{plan.length}</div><div className="lbl">Weeks total</div></div>
        <div className="stat-card"><div className="val">{user.ftp ? user.ftp + 'W' : '—'}</div><div className="lbl">FTP</div></div>
        <div className="stat-card"><div className="val">{doneSessions}/{totalSessions}</div><div className="lbl">Sessions done</div></div>
        <div className="stat-card"><div className="val">{pct}%</div><div className="lbl">Plan complete</div></div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          <span>Overall progress</span><span>{pct}%</span>
        </div>
        <div style={{ height: 6, background: 'var(--color-surface2)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--color-accent)', borderRadius: 3, transition: 'width 0.5s' }} />
        </div>
      </div>

      {/* Phase legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
        {Object.entries(PHASE_COLORS).map(([phase, color]) => (
          <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ textTransform: 'capitalize' }}>{phase.replace('-', ' ')}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Weekly volume</h2>
        <div style={{ height: 200 }}>
          <Bar data={chartData} options={chartOptions} />
        </div>
      </div>

      <div className="card">
        <h2>Event summary</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>
          <div><i className="ti ti-calendar" style={{ marginRight: 6 }} aria-hidden="true" />{user.event_date ? new Date(user.event_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not set'}</div>
          <div><i className="ti ti-map-pin" style={{ marginRight: 6 }} aria-hidden="true" />{user.event_name || 'Event not set'}</div>
          <div><i className="ti ti-route" style={{ marginRight: 6 }} aria-hidden="true" />{user.event_distance_km ? `${user.event_distance_km}km` : 'Distance not set'}</div>
          <div><i className="ti ti-user" style={{ marginRight: 6 }} aria-hidden="true" />Age group: {user.age_group || 'Not set'}</div>
        </div>
      </div>
    </div>
  )
}
