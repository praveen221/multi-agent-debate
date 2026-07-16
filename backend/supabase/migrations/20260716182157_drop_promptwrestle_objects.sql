-- Removed promptwrestle: unused, and its new-user trigger had a missing
-- search_path pin that broke Google sign-in for every app sharing this
-- Supabase project (any first-time signup fired this trigger and 500'd).
drop trigger if exists promptw_on_auth_user_created on auth.users;
drop function if exists public.promptw_handle_new_user();
drop view if exists public.promptw_challenge_leaderboard;
drop table if exists public.promptw_attempts;
drop table if exists public.promptw_profiles;
drop table if exists public.promptw_challenges;
