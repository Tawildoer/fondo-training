// ── Session scheduling ───────────────────────────────────────
// Shared date logic so the Calendar view, Today card, and .ics
// export all agree on which real-world date a session falls on.

export const DAY_OFFSETS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

// Monday of the calendar week containing `date`
function mondayOf(date) {
  const dow = date.getDay() // 0=Sun … 6=Sat
  const toMonday = dow === 0 ? -6 : 1 - dow
  const m = new Date(date)
  m.setDate(date.getDate() + toMonday)
  m.setHours(0, 0, 0, 0)
  return m
}

// The real-world date a given session lands on. Week 1 is anchored
// to the calendar week containing `base` (today by default).
export function getSessionDate(weekNum, session, sessionIdx, base = new Date()) {
  const b = new Date(base)
  b.setHours(0, 0, 0, 0)
  const weekStart = new Date(b)
  weekStart.setDate(b.getDate() + (weekNum - 1) * 7)
  const weekMonday = mondayOf(weekStart)
  const offset = DAY_OFFSETS[session.day] ?? sessionIdx
  const d = new Date(weekMonday)
  d.setDate(weekMonday.getDate() + offset)
  return d
}

// Flat list of every session with its computed date.
export function getScheduledSessions(plan, { includeRest = false, base = new Date() } = {}) {
  const out = []
  plan.forEach(week => {
    week.sessions.forEach((session, idx) => {
      if (!includeRest && session.zone === 'rest') return
      out.push({
        weekNum: week.num,
        idx,
        session,
        date: getSessionDate(week.num, session, idx, base),
      })
    })
  })
  return out
}

// Sessions scheduled for today (includes rest days).
export function getTodaySessions(plan, base = new Date()) {
  const today = new Date(base)
  today.setHours(0, 0, 0, 0)
  return getScheduledSessions(plan, { includeRest: true, base }).filter(
    s => s.date.getTime() === today.getTime()
  )
}

// ── Plan start anchoring ─────────────────────────────────────
// The plan is anchored to a fixed start date so it progresses through
// real time (week 1 doesn't slide forward with "today" every load).

// Local YYYY-MM-DD for a date (avoids UTC off-by-one).
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Parse a stored YYYY-MM-DD as a local date (not UTC).
export function parseLocalDate(str) {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// The fixed start date for a user's plan, at local midnight (today if unset).
export function getPlanStart(user) {
  const d = parseLocalDate(user?.plan_start_date) || new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// Which plan week the given date falls in (1-based). Caller clamps to plan length.
export function getCurrentWeekNum(planStart, base = new Date()) {
  const startMon = mondayOf(planStart)
  const nowMon = mondayOf(base)
  const weeks = Math.round((nowMon - startMon) / (7 * 24 * 60 * 60 * 1000))
  return Math.max(1, weeks + 1)
}

// Past, non-rest sessions the user hasn't confirmed (neither completed nor
// bailed). Drives the next-day "did you do it?" prompt — oldest first.
export function getUnconfirmedSessions(plan, sessionState, planStart, base = new Date()) {
  const today = new Date(base)
  today.setHours(0, 0, 0, 0)
  return getScheduledSessions(plan, { includeRest: false, base: planStart })
    .filter(({ date, weekNum, idx }) => {
      if (date.getTime() >= today.getTime()) return false
      const st = sessionState[`w${weekNum}_${idx}`] || {}
      return !st.completed && !st.bailed
    })
    .sort((a, b) => a.date - b.date)
}

// ── .ics export ──────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0') }
function fmtDate(d) { return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` }

function escapeICS(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Fold long lines at 75 chars per RFC 5545 (continuation lines start with a space).
function fold(line) {
  if (line.length <= 75) return line
  const parts = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  parts.push(' ' + rest)
  return parts.join('\r\n')
}

export function buildICS(plan, { calendarName = 'Training Plan', base = new Date() } = {}) {
  const sessions = getScheduledSessions(plan, { includeRest: false, base })
  const stamp = `${fmtDate(new Date())}T000000Z`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cycling Training Planner//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeICS(calendarName)}`,
  ]
  sessions.forEach(({ session, date, weekNum, idx }) => {
    const start = fmtDate(date)
    const next = new Date(date)
    next.setDate(date.getDate() + 1)
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:w${weekNum}-s${idx}-${start}@training-planner`)
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART;VALUE=DATE:${start}`)
    lines.push(`DTEND;VALUE=DATE:${fmtDate(next)}`)
    lines.push(fold(`SUMMARY:${escapeICS(session.name)}`))
    lines.push(fold(`DESCRIPTION:${escapeICS(session.desc)}`))
    lines.push('END:VEVENT')
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// Trigger a browser download of the plan as an .ics file.
export function downloadICS(plan, calendarName = 'Training Plan', base = new Date()) {
  const ics = buildICS(plan, { calendarName, base })
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${calendarName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
