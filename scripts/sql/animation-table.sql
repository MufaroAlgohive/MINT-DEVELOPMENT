-- ============================================================
-- animation — one-time tutorial "seen" ledger
-- ------------------------------------------------------------
-- Records that a given user has seen a given one-time tutorial
-- animation, so it never auto-plays again for them — on ANY
-- device (localStorage was per-browser and kept resetting).
--
-- Read/written by the mint app via src/lib/animationSeen.js.
-- Keys currently used:
--   'home_baskets_explainer'  — MintBasketsExplainer (Lottie, Markets/Home)
--   'portfolio_tour'          — SpotlightTour (Portfolio walkthrough)
--
-- Safe to run more than once.
-- ============================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

create table if not exists public.animation (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  animation_key text not null,
  seen_at       timestamptz not null default now(),
  unique (user_id, animation_key)
);

create index if not exists idx_animation_user on public.animation (user_id);

alter table public.animation enable row level security;

-- Each user manages only their own "seen" rows (browser anon key + session).
drop policy if exists "animation_select_own" on public.animation;
create policy "animation_select_own" on public.animation
  for select using (auth.uid() = user_id);

drop policy if exists "animation_insert_own" on public.animation;
create policy "animation_insert_own" on public.animation
  for insert with check (auth.uid() = user_id);
