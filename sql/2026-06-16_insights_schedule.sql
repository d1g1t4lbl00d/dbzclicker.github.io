-- =============================================================================
-- Insights de audiencia (eventos de reproducción) + programar publicaciones
-- =============================================================================
-- 1) eventos de reproducción
create table if not exists public.track_plays (
  id bigint generated always as identity primary key,
  track_id uuid references public.tracks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists track_plays_track_idx on public.track_plays(track_id, created_at);
alter table public.track_plays enable row level security;
drop policy if exists tp_insert on public.track_plays;
create policy tp_insert on public.track_plays for insert to authenticated with check (true);
drop policy if exists tp_select on public.track_plays;
create policy tp_select on public.track_plays for select to authenticated using (
  auth.uid() = user_id
  or auth.uid() = (select user_id from public.tracks where id = track_id)
  or public.is_admin()
);

-- 2) programar publicaciones
alter table public.tracks add column if not exists publish_at timestamptz;
