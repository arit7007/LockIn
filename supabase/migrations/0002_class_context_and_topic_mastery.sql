-- Adds per-class notes/context (grounds AI prompts in real class material,
-- instead of just name/difficulty/date) and per-topic mastery tracking on
-- profiles (so plans/reels can target actual weak spots instead of guessing).
-- Idempotent -- safe to run whether or not 0001_init.sql already includes
-- these columns.

alter table public.classes
  add column if not exists context text;

alter table public.profiles
  add column if not exists topic_mastery jsonb not null default '{}'::jsonb;
