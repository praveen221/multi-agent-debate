-- Phase 2 concierge: the pre-discussion intake step.
--
-- Every prompt now passes through a concierge that either opens a room, asks a
-- clarifying question, or answers inline. We persist every one of those
-- interactions — including answers and clarifications that never became a room
-- — so they can be surfaced back to the user, and denormalize the interpretation
-- onto the session it produced so the room can show a "here's how I read it"
-- banner without an extra read.

-- Denormalized banner data for a room that came through the concierge:
-- { "interpretation": text, "resolved": bool }. Null for sessions created
-- before this, or where the concierge resolved nothing worth showing.
alter table mad_sessions add column if not exists intake jsonb;

-- The full record of every concierge interaction, room-bound or not.
create table if not exists mad_intake (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,                  -- exactly what the user typed
  template_label text,                   -- the room type they were setting up
  mode text not null default 'discuss',  -- the room's interaction mode
  decision text not null check (decision in ('discuss', 'clarify', 'answer')),
  interpretation text,
  resolved boolean not null default false,
  refined_input text,                    -- disambiguated prompt (discuss)
  clarify jsonb,                         -- { question, options: [{label, refined_input}] }
  answer text,                           -- inline answer (answer)
  sources jsonb,                         -- web_search evidence used, if any
  session_id uuid references mad_sessions(id) on delete set null, -- room opened from this, if any
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);

create index mad_intake_user_id_idx on mad_intake(user_id);
create index mad_intake_session_id_idx on mad_intake(session_id);

-- Backend uses the service role key, which bypasses RLS; enabling it with no
-- policies keeps anon/authenticated clients out entirely (same as mad_feedback).
alter table mad_intake enable row level security;
