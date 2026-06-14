-- =============================================================================
-- UnderBro · Push social (likes, comentarios, seguidores, reposts, fotos)
-- -----------------------------------------------------------------------------
-- Mismo patrón que notify_new_dm: los triggers llaman a la edge function
-- send-push, pero aquí RESOLVEMOS en SQL a quién avisar y con qué texto y le
-- mandamos un payload ya hecho:  { "notify": { user_id, title, body, url, tag } }
-- send-push solo necesita una ramita nueva que entienda "notify" (ver índice.ts).
--
-- IMPORTANTE: sustituye __X_HOOK_SECRET__ por el mismo secreto que usa
-- notify_new_dm ANTES de ejecutar. No lo subas al repo (es público).
-- =============================================================================

-- Helper: manda un aviso push a un usuario concreto -----------------------------
create or replace function public.ub_push(target uuid, ntitle text, nbody text, nurl text, ntag text)
returns void
language plpgsql
security definer
set search_path to 'public', 'net', 'extensions'
as $$
begin
  if target is null then return; end if;
  perform net.http_post(
    url := 'https://hvpycejcaljgpxwnykuh.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', '__X_HOOK_SECRET__'
    ),
    body := jsonb_build_object('notify', jsonb_build_object(
      'recipient_id', target, 'title', ntitle, 'body', nbody, 'url', nurl, 'tag', ntag
    ))
  );
end;
$$;

-- LIKE en una pista -------------------------------------------------------------
create or replace function public.notify_track_like()
returns trigger language plpgsql security definer
set search_path to 'public', 'net', 'extensions' as $$
declare owner_id uuid; tname text; aname text;
begin
  select user_id, title into owner_id, tname from public.tracks where id = NEW.track_id;
  if owner_id is null or owner_id = NEW.user_id then return NEW; end if;
  select coalesce(display_name, username, 'Alguien') into aname from public.profiles where id = NEW.user_id;
  perform public.ub_push(owner_id, aname,
    '❤️ le gusta tu pista «' || coalesce(tname, '') || '»',
    '/?track=' || NEW.track_id, 'like-' || NEW.track_id);
  return NEW;
end; $$;

-- COMENTARIO en una pista -------------------------------------------------------
create or replace function public.notify_track_comment()
returns trigger language plpgsql security definer
set search_path to 'public', 'net', 'extensions' as $$
declare owner_id uuid; tname text; aname text;
begin
  select user_id, title into owner_id, tname from public.tracks where id = NEW.track_id;
  if owner_id is null or owner_id = NEW.user_id then return NEW; end if;
  select coalesce(display_name, username, 'Alguien') into aname from public.profiles where id = NEW.user_id;
  perform public.ub_push(owner_id, aname,
    '💬 comentó tu pista «' || coalesce(tname, '') || '»: ' || left(coalesce(NEW.body, ''), 80),
    '/?track=' || NEW.track_id, 'comment-' || NEW.track_id);
  return NEW;
end; $$;

-- REPOST de una pista -----------------------------------------------------------
create or replace function public.notify_track_repost()
returns trigger language plpgsql security definer
set search_path to 'public', 'net', 'extensions' as $$
declare owner_id uuid; tname text; aname text;
begin
  select user_id, title into owner_id, tname from public.tracks where id = NEW.track_id;
  if owner_id is null or owner_id = NEW.user_id then return NEW; end if;
  select coalesce(display_name, username, 'Alguien') into aname from public.profiles where id = NEW.user_id;
  perform public.ub_push(owner_id, aname,
    '🔁 reposteó tu pista «' || coalesce(tname, '') || '»',
    '/?track=' || NEW.track_id, 'repost-' || NEW.track_id);
  return NEW;
end; $$;

-- NUEVO SEGUIDOR ----------------------------------------------------------------
create or replace function public.notify_new_follow()
returns trigger language plpgsql security definer
set search_path to 'public', 'net', 'extensions' as $$
declare aname text;
begin
  if NEW.follower_id = NEW.following_id then return NEW; end if;
  select coalesce(display_name, username, 'Alguien') into aname from public.profiles where id = NEW.follower_id;
  perform public.ub_push(NEW.following_id, aname,
    '👤 empezó a seguirte', '/', 'follow-' || NEW.follower_id);
  return NEW;
end; $$;

-- LIKE en una foto --------------------------------------------------------------
create or replace function public.notify_post_like()
returns trigger language plpgsql security definer
set search_path to 'public', 'net', 'extensions' as $$
declare owner_id uuid; aname text;
begin
  select user_id into owner_id from public.posts where id = NEW.post_id;
  if owner_id is null or owner_id = NEW.user_id then return NEW; end if;
  select coalesce(display_name, username, 'Alguien') into aname from public.profiles where id = NEW.user_id;
  perform public.ub_push(owner_id, aname,
    '❤️ le gusta tu foto', '/?post=' || NEW.post_id, 'plike-' || NEW.post_id);
  return NEW;
end; $$;

-- COMENTARIO en una foto --------------------------------------------------------
create or replace function public.notify_post_comment()
returns trigger language plpgsql security definer
set search_path to 'public', 'net', 'extensions' as $$
declare owner_id uuid; aname text;
begin
  select user_id into owner_id from public.posts where id = NEW.post_id;
  if owner_id is null or owner_id = NEW.user_id then return NEW; end if;
  select coalesce(display_name, username, 'Alguien') into aname from public.profiles where id = NEW.user_id;
  perform public.ub_push(owner_id, aname,
    '💬 comentó tu foto: ' || left(coalesce(NEW.body, ''), 80),
    '/?post=' || NEW.post_id, 'pcomment-' || NEW.post_id);
  return NEW;
end; $$;

-- Triggers (AFTER INSERT) -------------------------------------------------------
drop trigger if exists trg_notify_track_like    on public.likes;
drop trigger if exists trg_notify_track_comment on public.comments;
drop trigger if exists trg_notify_track_repost  on public.reposts;
drop trigger if exists trg_notify_new_follow    on public.follows;
drop trigger if exists trg_notify_post_like     on public.post_likes;
drop trigger if exists trg_notify_post_comment  on public.post_comments;

create trigger trg_notify_track_like    after insert on public.likes         for each row execute function public.notify_track_like();
create trigger trg_notify_track_comment after insert on public.comments       for each row execute function public.notify_track_comment();
create trigger trg_notify_track_repost  after insert on public.reposts        for each row execute function public.notify_track_repost();
create trigger trg_notify_new_follow    after insert on public.follows        for each row execute function public.notify_new_follow();
create trigger trg_notify_post_like     after insert on public.post_likes     for each row execute function public.notify_post_like();
create trigger trg_notify_post_comment  after insert on public.post_comments  for each row execute function public.notify_post_comment();

-- Endurecimiento: estas funciones son de trigger, nadie debe ejecutarlas a mano
revoke execute on function public.ub_push(uuid, text, text, text, text)       from public, anon, authenticated;
revoke execute on function public.notify_track_like()    from public, anon, authenticated;
revoke execute on function public.notify_track_comment() from public, anon, authenticated;
revoke execute on function public.notify_track_repost()  from public, anon, authenticated;
revoke execute on function public.notify_new_follow()    from public, anon, authenticated;
revoke execute on function public.notify_post_like()     from public, anon, authenticated;
revoke execute on function public.notify_post_comment()  from public, anon, authenticated;
