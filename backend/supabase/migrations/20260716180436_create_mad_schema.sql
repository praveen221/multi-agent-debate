-- Multi-agent debate: sessions, turns, and per-user rate limiting.
-- All reads/writes go through the backend using the service-role key, which
-- bypasses RLS. Policies below are least-privilege defense-in-depth (read-only
-- for the owning user) and leave room for a future Realtime-subscription UI
-- without needing a schema change.

create table mad_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  topic text not null,
  agents jsonb not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table mad_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references mad_sessions(id) on delete cascade,
  turn_index integer not null,
  speaker text not null,
  text text not null,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);

create index mad_turns_session_id_idx on mad_turns(session_id);

create table mad_rate_limits (
  user_id uuid primary key references auth.users(id),
  window_start timestamptz not null default now(),
  request_count integer not null default 0
);

alter table mad_sessions enable row level security;
alter table mad_turns enable row level security;
alter table mad_rate_limits enable row level security;

create policy "Users can view their own sessions"
  on mad_sessions for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can view turns in their own sessions"
  on mad_turns for select
  to authenticated
  using (
    exists (
      select 1 from mad_sessions
      where mad_sessions.id = mad_turns.session_id
      and mad_sessions.user_id = auth.uid()
    )
  );

-- mad_rate_limits: no policies for authenticated/anon — service-role only.
