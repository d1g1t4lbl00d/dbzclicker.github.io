-- =============================================================================
-- Trending v2 — algoritmo "hot score" mejorado (aplicado 2026-06-23)
-- =============================================================================
-- Mejoras frente a la v1:
--   1) REPRODUCCIONES RECIENTES REALES: usa public.track_plays (eventos con
--      fecha) para contar escuchas dentro de la ventana, no solo el contador
--      acumulado. Cuenta usuarios DISTINTOS para que repetir una pista no infle.
--   2) ANTI-SPAM: no cuenta autointeracciones (el autor dándose like/repost/
--      play/comentario a sí mismo) ni interacciones de cuentas con < 1 día de
--      antigüedad (cuentas recién creadas para inflar).
--   3) ANTI-MONOPOLIO: máximo 3 pistas por artista en el ranking, para que un
--      solo artista no cope el Top.
--   4) Pesos reajustados (repros recientes como nueva señal; baseline acumulado
--      con menos peso para no premiar a las pistas más antiguas).
--
-- SECURITY DEFINER: track_plays solo permite SELECT al dueño/admin (privacidad),
-- así que la función se ejecuta con privilegios del propietario para poder
-- AGREGAR las reproducciones de todos. Solo devuelve filas de `tracks` (datos
-- públicos) y conteos agregados — nunca expone quién reprodujo qué.

create or replace function public.trending_tracks(p_days int default 2, p_limit int default 50)
returns setof public.tracks
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select (now() - make_interval(days => greatest(p_days, 1)))::timestamptz as since,
           (now() - interval '1 day')::timestamptz as min_acct      -- cuenta mínima 1 día
  ),
  -- likes recientes (usuarios distintos, sin autolikes ni cuentas nuevas)
  rl as (
    select l.track_id, count(distinct l.user_id)::numeric c
    from likes l
    join tracks tt on tt.id = l.track_id
    join profiles pa on pa.id = l.user_id
    cross join win
    where l.created_at > win.since and l.user_id <> tt.user_id and pa.created_at < win.min_acct
    group by l.track_id
  ),
  -- reposts recientes
  rr as (
    select r.track_id, count(distinct r.user_id)::numeric c
    from reposts r
    join tracks tt on tt.id = r.track_id
    join profiles pa on pa.id = r.user_id
    cross join win
    where r.created_at > win.since and r.user_id <> tt.user_id and pa.created_at < win.min_acct
    group by r.track_id
  ),
  -- comentarios recientes
  rc as (
    select c.track_id, count(distinct c.user_id)::numeric c
    from comments c
    join tracks tt on tt.id = c.track_id
    join profiles pa on pa.id = c.user_id
    cross join win
    where c.created_at > win.since and c.user_id <> tt.user_id and pa.created_at < win.min_acct
    group by c.track_id
  ),
  -- reproducciones recientes REALES (usuarios distintos, sin autoescuchas)
  rp as (
    select tp.track_id, count(distinct tp.user_id)::numeric c
    from track_plays tp
    join tracks tt on tt.id = tp.track_id
    cross join win
    where tp.created_at > win.since and tp.user_id is not null and tp.user_id <> tt.user_id
    group by tp.track_id
  ),
  scored as (
    select t as trk,
      ( coalesce(rl.c, 0) * 3                                  -- likes recientes
      + coalesce(rr.c, 0) * 5                                  -- reposts recientes (más fuerte)
      + coalesce(rc.c, 0) * 2.5                                -- comentarios recientes
      + coalesce(rp.c, 0) * 1.5                                -- reproducciones recientes reales
      + least(coalesce(t.plays, 0), 1000) * 0.01              -- baseline acumulado (tope, poco peso)
      + case when t.created_at > win.since then 8 else 0 end   -- empujón a novedades
      - (extract(epoch from (now() - t.created_at)) / 86400.0) * 0.2  -- decaimiento por antigüedad
      )::numeric as score
    from tracks t
    cross join win
    left join rl on rl.track_id = t.id
    left join rr on rr.track_id = t.id
    left join rc on rc.track_id = t.id
    left join rp on rp.track_id = t.id
  ),
  capped as (
    select trk, score,
      row_number() over (
        partition by (trk).user_id
        order by score desc, (trk).plays desc nulls last, (trk).created_at desc
      ) as rn
    from scored
  )
  select (trk).*
  from capped
  where rn <= 3                          -- máx. 3 pistas por artista (anti-monopolio)
  order by score desc, (trk).plays desc nulls last, (trk).created_at desc
  limit greatest(p_limit, 1);
$$;

revoke all on function public.trending_tracks(int, int) from public;
grant execute on function public.trending_tracks(int, int) to anon, authenticated;
