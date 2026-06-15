-- ============================================================
-- Cycling Training Planner — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- 1. Invite codes table (you manage this manually)
create table invite_codes (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  label text,                        -- e.g. "for James"
  claimed_by uuid references users(id),
  claimed_at timestamptz,
  created_at timestamptz default now()
);

-- 2. Users table (created on first login with invite code)
create table users (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  invite_code text not null references invite_codes(code),
  -- Event info
  event_name text,
  event_date date,
  event_distance_km int,
  event_type text,                   -- gran_fondo, road_race, criterium, sportive, other
  weeks_available int,
  -- Fitness
  ftp int,                           -- null = skipped
  max_hr int,                        -- null = skipped
  age_group text,
  riding_strength text,              -- climber, sprinter, time_trialist, all_rounder
  weekly_hours_start int,
  days_per_week int,
  -- Meta
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. Session state (checkbox + RPE per session per user)
create table session_state (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  week_num int not null,
  session_idx int not null,
  completed boolean default false,
  rpe int check (rpe between 1 and 5),
  completed_at timestamptz,
  updated_at timestamptz default now(),
  unique (user_id, week_num, session_idx)
);

-- 4. Adjustments log
create table adjustments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  week_num int,
  change_type text,
  hours_completed numeric(4,1),
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security — each user only sees their own data
-- ============================================================

alter table users enable row level security;
alter table session_state enable row level security;
alter table adjustments enable row level security;
alter table invite_codes enable row level security;

-- Users can read/update their own row (matched by stored user_id in app)
create policy "users_select_own" on users for select using (true);
create policy "users_insert_own" on users for insert with check (true);
create policy "users_update_own" on users for update using (true);

-- Session state open to all authenticated reads/writes (user_id enforced in app)
create policy "session_state_all" on session_state for all using (true);

-- Adjustments open similarly
create policy "adjustments_all" on adjustments for all using (true);

-- Invite codes: anyone can read (to validate), only service role can insert
create policy "invite_codes_select" on invite_codes for select using (true);
create policy "invite_codes_update" on invite_codes for update using (true);

-- ============================================================
-- Seed your initial invite codes here
-- Replace the code values with whatever you want to send friends
-- ============================================================

insert into invite_codes (code, label) values
  ('TOM-2026',   'Tom — owner'),
  ('JAMES-RIDE', 'For James'),
  ('SARA-FONDO', 'For Sara');

-- Add more any time:
-- insert into invite_codes (code, label) values ('NEW-CODE', 'For whoever');
