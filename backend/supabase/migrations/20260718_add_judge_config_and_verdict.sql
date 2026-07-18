-- The LLM judge: per-session judge config, a 'judge' turn role, and a
-- structured verdict payload on judge turns.
alter table mad_turns drop constraint mad_turns_role_check;
alter table mad_turns add constraint mad_turns_role_check check (role in ('agent', 'human', 'judge'));

-- Structured judge output (direction, agreements, contentions, suggested
-- action, kind = verdict | intervention). Null on agent/human turns.
alter table mad_turns add column verdict jsonb;

-- {"enabled": bool, "model": str}. Null = no judge (all sessions created
-- before this feature); the frontend sends a default on new sessions.
alter table mad_sessions add column judge jsonb;
