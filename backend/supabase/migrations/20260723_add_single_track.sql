-- Phase 3: the single-model track + the debate-vs-single benchmark.
--
-- Alongside a debate, a user can open one strong single model on the same topic
-- (opt-in, so cost is only paid when they ask). Its answers, the interventions
-- fanned in from the debate, and the user's "which was more useful" verdict all
-- persist here so a benchmark can eventually be surfaced.

-- The single model chosen for this session's single track: {model, use_search}.
-- Null = no single track opened.
alter table mad_sessions add column if not exists single_agent jsonb;

-- The single track's turns: the model's answers plus the human/judge
-- interventions fanned in from the debate.
create table if not exists mad_single_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references mad_sessions(id) on delete cascade,
  turn_index integer not null,
  role text not null default 'single' check (role in ('single', 'human', 'judge')),
  text text not null,
  sources jsonb,
  option_label text,           -- the follow-up option that prompted a 'single' turn
  options jsonb,               -- the follow-up options offered after this turn (survive reload)
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);

create index if not exists mad_single_turns_session_id_idx on mad_single_turns(session_id);

-- The benchmark verdict: which track the user found more useful. Kept separate
-- from mad_feedback (general app feedback) and the star-ratings on purpose —
-- this is the comparison signal a benchmark is built from. One verdict per
-- session per user, re-answerable.
create table if not exists mad_comparisons (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references mad_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  preference text not null check (preference in ('single', 'multi')),
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create index if not exists mad_comparisons_session_id_idx on mad_comparisons(session_id);

-- Backend uses the service role key (bypasses RLS); enabling it with no policies
-- keeps anon/authenticated clients out entirely (same as mad_feedback/mad_intake).
alter table mad_single_turns enable row level security;
alter table mad_comparisons enable row level security;
