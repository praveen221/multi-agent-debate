-- Replace the time-windowed request rate limit with a hard per-user dollar
-- spend cap. Owner can raise a specific user's limit_usd manually via
-- Supabase when they email in for more credits.
drop table if exists mad_rate_limits;

create table mad_user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spent_usd numeric(12,8) not null default 0,
  limit_usd numeric(12,8) not null default 5.00,
  updated_at timestamptz not null default now()
);

alter table mad_user_credits enable row level security;

create policy "Users can view their own credit balance"
  on mad_user_credits for select
  to authenticated
  using (user_id = auth.uid());

alter table mad_turns add column cost_usd numeric(12,8) not null default 0;
