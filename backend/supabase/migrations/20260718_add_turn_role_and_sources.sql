-- Support non-agent rows in the transcript (human steering messages) and
-- persist full search grounding (query + results) instead of discarding it
-- once a turn finishes streaming.
alter table mad_turns add column role text not null default 'agent'
  check (role in ('agent', 'human'));

alter table mad_turns add column sources jsonb;
