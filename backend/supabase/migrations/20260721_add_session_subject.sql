-- What the user actually typed, kept separate from the composed instruction
-- sent to agents (mad_sessions.topic). The header shows subject + a template
-- chip instead of the full composed prompt, which was both truncating badly
-- and reading as "why is my app echoing an appended prompt back at me".
alter table mad_sessions add column if not exists subject text;
alter table mad_sessions add column if not exists template_label text;
