-- ============================================================
-- Cycling Training Planner — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- 1. Users table (auth_id links to Supabase Auth)
create table users (
  id uuid default gen_random_uuid() primary key,
  auth_id uuid references auth.users(id) on delete cascade,
  name text not null,
  -- Event info
  event_name text,
  event_date date,
  event_distance_km int,
  event_type text,               -- gran_fondo, road_race, criterium, sportive, other
  weeks_available int,
  -- Fitness
  ftp int,
  max_hr int,
  age_group text,
  riding_strength text,          -- climber, sprinter, time_trialist, all_rounder
  weekly_hours_start int,
  days_per_week int,
  -- Plan anchoring (fixed start so the plan progresses through real time)
  plan_start_date date,
  -- Meta
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint users_auth_id_key unique (auth_id)
);
-- Migration for existing databases (safe to re-run):
--   alter table users add column if not exists plan_start_date date;

-- 2. Session state (checkbox + RPE + notes per session per user)
create table session_state (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  week_num int not null,
  session_idx int not null,
  completed boolean default false,
  bailed boolean default false,    -- explicitly marked missed / bailed on
  auto_completed boolean default false, -- completed automatically from a matched Strava ride
  rpe int check (rpe between 1 and 5),
  notes text,
  completed_at timestamptz,
  updated_at timestamptz default now(),
  unique (user_id, week_num, session_idx)
);
-- Migration for existing databases (safe to re-run):
--   alter table session_state add column if not exists bailed boolean default false;
--   alter table session_state add column if not exists auto_completed boolean default false;

-- 2b. FTP history (one row per logged FTP update)
create table ftp_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  ftp int not null,
  recorded_at timestamptz default now()
);

-- 2c. Strava OAuth accounts (one per user)
create table strava_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  athlete_id bigint,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,          -- unix seconds
  scope text,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2d. Imported Strava activities (metrics + downsampled streams)
create table activities (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  strava_id bigint not null,
  name text,
  sport_type text,
  start_date timestamptz,
  distance_m numeric,
  moving_time_s int,
  elapsed_time_s int,
  total_elevation_m numeric,
  avg_watts numeric,
  weighted_avg_watts numeric,
  max_watts numeric,
  avg_hr numeric,
  max_hr numeric,
  avg_cadence numeric,
  kilojoules numeric,
  calories numeric,
  streams jsonb,                       -- { time, watts, heartrate, cadence, altitude }
  created_at timestamptz default now(),
  unique (user_id, strava_id)
);

-- 3. Adjustments log
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
-- Row Level Security
-- ============================================================

alter table users enable row level security;
alter table session_state enable row level security;
alter table adjustments enable row level security;
alter table ftp_history enable row level security;
alter table strava_accounts enable row level security;
alter table activities enable row level security;

create policy "users_select_own"  on users for select using (auth.uid() = auth_id);
create policy "users_insert_own"  on users for insert with check (auth.uid() = auth_id);
create policy "users_update_own"  on users for update using (auth.uid() = auth_id);

create policy "session_state_all" on session_state for all using (
  user_id in (select id from users where auth_id = auth.uid())
);

create policy "adjustments_all" on adjustments for all using (
  user_id in (select id from users where auth_id = auth.uid())
);

create policy "ftp_history_all" on ftp_history for all using (
  user_id in (select id from users where auth_id = auth.uid())
);

create policy "strava_accounts_all" on strava_accounts for all using (
  user_id in (select id from users where auth_id = auth.uid())
);

create policy "activities_all" on activities for all using (
  user_id in (select id from users where auth_id = auth.uid())
);


-- ============================================================
-- MIGRATION — run this if you already have the old schema
-- (invite_codes table + invite_code column on users)
-- ============================================================

-- 1. Add auth_id column
-- alter table users add column auth_id uuid references auth.users(id) on delete cascade;
-- alter table users add constraint users_auth_id_key unique (auth_id);

-- 2. Make invite_code nullable so existing rows aren't broken
-- alter table users alter column invite_code drop not null;

-- 3. Drop old invite_codes RLS
-- drop policy if exists "invite_codes_select" on invite_codes;
-- drop policy if exists "invite_codes_update" on invite_codes;

-- 4. Replace users RLS policies
-- drop policy if exists "users_select_own" on users;
-- drop policy if exists "users_insert_own" on users;
-- drop policy if exists "users_update_own" on users;

-- create policy "users_select_own"  on users for select using (auth.uid() = auth_id);
-- create policy "users_insert_own"  on users for insert with check (auth.uid() = auth_id);
-- create policy "users_update_own"  on users for update using (auth.uid() = auth_id);

-- 5. Replace session_state + adjustments RLS
-- drop policy if exists "session_state_all" on session_state;
-- create policy "session_state_all" on session_state for all using (
--   user_id in (select id from users where auth_id = auth.uid())
-- );

-- drop policy if exists "adjustments_all" on adjustments;
-- create policy "adjustments_all" on adjustments for all using (
--   user_id in (select id from users where auth_id = auth.uid())
-- );


-- ============================================================
-- MIGRATION — session notes + FTP history (run this next)
-- ============================================================

-- 1. Session notes column
-- alter table session_state add column notes text;

-- 2. FTP history table
-- create table ftp_history (
--   id uuid default gen_random_uuid() primary key,
--   user_id uuid not null references users(id) on delete cascade,
--   ftp int not null,
--   recorded_at timestamptz default now()
-- );
-- alter table ftp_history enable row level security;
-- create policy "ftp_history_all" on ftp_history for all using (
--   user_id in (select id from users where auth_id = auth.uid())
-- );

-- 3. (Optional) seed history with each user's current FTP so the chart isn't empty
-- insert into ftp_history (user_id, ftp)
--   select id, ftp from users where ftp is not null;


-- ============================================================
-- MIGRATION — Strava integration (run this next)
-- ============================================================

-- create table strava_accounts (
--   user_id uuid primary key references users(id) on delete cascade,
--   athlete_id bigint,
--   access_token text not null,
--   refresh_token text not null,
--   expires_at bigint not null,
--   scope text,
--   last_synced_at timestamptz,
--   created_at timestamptz default now(),
--   updated_at timestamptz default now()
-- );

-- create table activities (
--   id uuid default gen_random_uuid() primary key,
--   user_id uuid not null references users(id) on delete cascade,
--   strava_id bigint not null,
--   name text,
--   sport_type text,
--   start_date timestamptz,
--   distance_m numeric,
--   moving_time_s int,
--   elapsed_time_s int,
--   total_elevation_m numeric,
--   avg_watts numeric,
--   weighted_avg_watts numeric,
--   max_watts numeric,
--   avg_hr numeric,
--   max_hr numeric,
--   avg_cadence numeric,
--   kilojoules numeric,
--   calories numeric,
--   streams jsonb,
--   created_at timestamptz default now(),
--   unique (user_id, strava_id)
-- );

-- alter table strava_accounts enable row level security;
-- alter table activities enable row level security;

-- create policy "strava_accounts_all" on strava_accounts for all using (
--   user_id in (select id from users where auth_id = auth.uid())
-- );
-- create policy "activities_all" on activities for all using (
--   user_id in (select id from users where auth_id = auth.uid())
-- );
