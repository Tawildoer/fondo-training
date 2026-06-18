# Training Planner — Feature Roadmap

A running list of feature ideas, grouped by effort vs. payoff. Captured 2026-06-17.

## Context / the core gap

The plan is currently **static** — it generates templates per phase (base / build / race-prep / taper)
but never changes based on what the athlete actually does. The app collects completion + RPE data,
then mostly just shows a coaching banner. Most of the high-value ideas below are about closing that
loop: using the data the app already collects.

---

## Quick wins (low effort, genuinely useful)

- ✅ **Calendar export (.ics)** — _shipped 2026-06-17._ "Add to calendar" button on the Calendar tab
  downloads an .ics of all sessions. Date logic shared via `src/lib/schedule.js`.
- ✅ **Session notes** — _shipped 2026-06-17._ Free-text note per session in Training weeks
  (`session_state.notes`).
- ✅ **FTP history + progression chart** — _shipped 2026-06-17._ SVG line chart on the Power zones tab;
  every FTP update logs to the `ftp_history` table.
- ✅ **"Today" card on the Overview tab** — _shipped 2026-06-17._ Surfaces today's session(s) at the top
  with an inline complete checkbox.

## Medium bets

- **Genuinely adaptive plan** — regenerate upcoming weeks from real signals: consistently high RPE →
  soften next block; missed sessions → redistribute load; easy RPE → progress faster. Turns a plan
  generator into a coach, built on data already collected.
- **Training load tracking (PMC-style)** — fitness / fatigue / form curves. Expected by anyone coming
  from TrainingPeaks/Strava; gives the Overview tab real analytical weight.
- **Email reminders / PWA + push** — "your threshold session is on today." Drives the daily habit that
  makes a training app stick.

## Big swings (high payoff, real work)

- 🟡 **Strava integration** — _in progress 2026-06-17._ Manual "Sync rides" button pulls recent rides
  + data streams (Strava API can't export the raw FIT file). Metrics + power/HR graph attach to each
  session, matched by date. Backend: Vercel functions `api/strava-exchange` + `api/strava-sync`;
  tables `strava_accounts` + `activities`. Needs Strava app creation + 3 env vars (see below).
  _Not yet done:_ auto-import via webhooks; auto-complete sessions from matched rides; planned-vs-actual.
- **Coach ↔ athlete view** — with self-signup + multi-user auth in place, a coach dashboard to monitor
  athletes is a natural extension and a plausible monetization path.
- **Gamification — skill trees & levelling up** ⭐ — make the app *feel like a game* where you level up
  as you train. The data to drive this already exists (completed sessions, RPE, FTP gains, streaks).
  Possible mechanics:
  - **XP & levels** — earn XP for completing sessions (bonus for hard ones / hitting RPE targets),
    level up an overall "rider level."
  - **Skill trees** — branches per discipline (e.g. Climber / Sprinter / Time-trialist / Endurance)
    that unlock as you log the relevant session types. Mirrors the existing `riding_strength` profile.
  - **Badges / achievements** — first century ride, 4-week streak, new FTP PB, completed a full phase,
    perfect recovery week, etc.
  - **Streaks & consistency meter** — reward not missing sessions; tie into the adaptive coaching.
  - **Stat progression** — surface FTP, weekly volume, and training load as "character stats" that
    visibly grow over the plan.
  - Likely needs: an XP/achievements schema, an event log of what earned what, and a new "Progress"
    or "Rider" tab to show level, skill tree, and badges. Pairs naturally with the adaptive-plan and
    training-load ideas above.

---

## Suggested order

1. **Calendar export** — a same-day win.
2. **Adaptive plan** — the thing that turns this from "a plan generator" into "a coach," and mostly
   logic on existing data rather than new infrastructure.
