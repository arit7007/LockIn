create extension if not exists pgcrypto;

-- profiles: one row per auth user, holds onboarding answers + aggregate stats
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  level text not null default 'High school',
  prefs jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  streak integer not null default 0,
  last_active date,
  daily jsonb not null default '{}'::jsonb,
  plans_made integer not null default 0,
  reels_answered integer not null default 0,
  reels_correct integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- auto-provision a profiles row when a new auth user signs up
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- classes: a student's courses/subjects
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  next_test date,
  created_at timestamptz not null default now()
);

create index classes_user_id_idx on public.classes(user_id);

alter table public.classes enable row level security;

create policy "classes_select_own" on public.classes
  for select using (auth.uid() = user_id);

create policy "classes_insert_own" on public.classes
  for insert with check (auth.uid() = user_id);

create policy "classes_update_own" on public.classes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "classes_delete_own" on public.classes
  for delete using (auth.uid() = user_id);

-- study_plans: generated plans, kept so they survive a refresh
create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  input jsonb not null,
  plan jsonb not null,
  source text not null check (source in ('ai', 'fallback')),
  created_at timestamptz not null default now()
);

create index study_plans_user_id_idx on public.study_plans(user_id, created_at desc);

alter table public.study_plans enable row level security;

create policy "study_plans_select_own" on public.study_plans
  for select using (auth.uid() = user_id);

create policy "study_plans_insert_own" on public.study_plans
  for insert with check (auth.uid() = user_id);

create policy "study_plans_delete_own" on public.study_plans
  for delete using (auth.uid() = user_id);
