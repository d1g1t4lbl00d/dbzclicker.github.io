-- =============================================================================
-- Juegos 1v1 online — "Duelo" (reflejos al estilo Western/FPS) — 2026-06-23
-- =============================================================================
-- Mecánica: suena una canción aleatoria; al cortarse, el primero en tocar gana.
-- Cada cliente mide SU tiempo de reacción localmente (justo sin importar el ping)
-- y se compara. Salida en falso (tocar antes del corte) = pierde la ronda.

create table if not exists public.game_matches (
  id uuid primary key default gen_random_uuid(),
  game text not null default 'duel',
  host uuid not null references auth.users(id) on delete cascade,
  guest uuid references auth.users(id) on delete cascade,
  status text not null default 'open',     -- open | invited | ready | playing | done | cancelled
  is_public boolean not null default false, -- true = partida rápida (cualquiera puede unirse)
  track_id uuid references public.tracks(id) on delete set null,
  audio_url text,
  cover_url text,
  track_title text,
  stop_offset int,                          -- ms tras empezar a sonar en que se corta
  host_ready boolean not null default false,
  guest_ready boolean not null default false,
  host_reaction int,                        -- ms; -1 = salida en falso
  guest_reaction int,
  host_name text,
  guest_name text,
  host_avatar text,
  guest_avatar text,
  winner uuid,
  round int not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists gm_open_idx on public.game_matches(status, is_public, created_at);
create index if not exists gm_guest_idx on public.game_matches(guest, status);

alter table public.game_matches enable row level security;

drop policy if exists gm_select on public.game_matches;
create policy gm_select on public.game_matches for select to authenticated using (
  host = auth.uid() or guest = auth.uid() or (is_public and status = 'open')
);
drop policy if exists gm_insert on public.game_matches;
create policy gm_insert on public.game_matches for insert to authenticated with check (host = auth.uid());
drop policy if exists gm_update on public.game_matches;
create policy gm_update on public.game_matches for update to authenticated using (
  host = auth.uid() or guest = auth.uid() or (is_public and status = 'open' and guest is null)
);
drop policy if exists gm_delete on public.game_matches;
create policy gm_delete on public.game_matches for delete to authenticated using (host = auth.uid() or guest = auth.uid());

grant select, insert, update, delete on public.game_matches to authenticated;

-- Realtime
do $$ begin
  alter publication supabase_realtime add table public.game_matches;
exception when duplicate_object then null; end $$;
