-- Optimización de rendimiento de la base de datos (Supabase database linter)
-- Aplicado el 2026-06-12. Resolvía 108 avisos: 74 auth_rls_initplan,
-- 20 multiple_permissive_policies y 12 unindexed_foreign_keys.

-- 1) Consolidar politicas permisivas duplicadas (admin + propia) en una sola
drop policy if exists comments_admin_del on public.comments;
drop policy if exists comments_delete_own on public.comments;
create policy comments_delete on public.comments for delete
  using (is_admin() or (select auth.uid()) = user_id);

drop policy if exists messages_admin_del on public.messages;
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete on public.messages for delete
  using (is_admin() or (select auth.uid()) = user_id);

drop policy if exists tracks_admin_all on public.tracks;
drop policy if exists tracks_delete_own on public.tracks;
create policy tracks_delete on public.tracks for delete
  using (is_admin() or (select auth.uid()) = user_id);

drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update on public.profiles for update
  using (is_admin() or (select auth.uid()) = id);

-- 2) Envolver auth.uid() en (select ...) en TODAS las politicas restantes.
--    Sin esto, Postgres re-evalua auth.uid() POR CADA FILA; envuelto se evalua
--    una sola vez por consulta (initplan) — mejora real en cada peticion.
do $$
declare
  r record; nq text; nc text; stmt text;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') ~ 'auth\.uid\(\)' or coalesce(with_check,'') ~ 'auth\.uid\(\)')
      and coalesce(qual,'') !~ 'SELECT auth\.uid\(\)'
      and coalesce(with_check,'') !~ 'SELECT auth\.uid\(\)'
  loop
    nq := regexp_replace(r.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    nc := regexp_replace(r.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then stmt := stmt || format(' using (%s)', nq); end if;
    if r.with_check is not null then stmt := stmt || format(' with check (%s)', nc); end if;
    execute stmt;
  end loop;
end $$;

-- 3) Indices para claves foraneas sin cubrir (joins y deletes en cascada)
create index if not exists comments_user_idx        on public.comments (user_id);
create index if not exists conversations_creator_idx on public.conversations (created_by);
create index if not exists dm_reply_to_idx          on public.direct_messages (reply_to);
create index if not exists follows_following_idx    on public.follows (following_id);
create index if not exists group_messages_sender_idx on public.group_messages (sender_id);
create index if not exists likes_user_idx           on public.likes (user_id);
create index if not exists messages_user_idx        on public.messages (user_id);
create index if not exists playlist_tracks_track_idx on public.playlist_tracks (track_id);
create index if not exists post_comments_user_idx   on public.post_comments (user_id);
create index if not exists post_likes_user_idx      on public.post_likes (user_id);
create index if not exists stories_track_idx        on public.stories (track_id);
create index if not exists story_views_viewer_idx   on public.story_views (viewer_id);

-- NOTA: quedan 2 avisos de "unused_index" en announcements; se dejan a proposito
-- (la app es joven, se usaran cuando crezca el volumen de anuncios).
