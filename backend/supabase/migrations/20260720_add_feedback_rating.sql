-- Star-rating micro-feedback: rating prompts at the conclude moment and at
-- deep round boundaries write into the same table as the manual feedback box.
alter table mad_feedback add column if not exists rating int check (rating between 1 and 5);
alter table mad_feedback add column if not exists trigger_point text;
