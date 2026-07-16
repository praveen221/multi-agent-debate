-- Deleting a user should take their debate data with them, not block deletion.
alter table mad_sessions drop constraint mad_sessions_user_id_fkey;
alter table mad_sessions add constraint mad_sessions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table mad_rate_limits drop constraint mad_rate_limits_user_id_fkey;
alter table mad_rate_limits add constraint mad_rate_limits_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
