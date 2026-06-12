-- Endurecimiento de seguridad (Supabase database linter)
-- Aplicado el 2026-06-12 sobre el proyecto de Supabase.
-- Objetivo: quitar EXECUTE publico de funciones SECURITY DEFINER que la API
-- expone via /rest/v1/rpc/ y que NO deben ser invocables externamente.
--
-- Verificacion previa: el frontend solo invoca por RPC `increment_plays`.
-- Las funciones de abajo son triggers (las dispara el motor, no la API),
-- tareas de mantenimiento, o ayudantes internos de RLS solo para usuarios
-- autenticados.

-- 1) Funciones trigger + mantenimiento: nunca se llaman por API.
--    Los triggers siguen ejecutandose: corren como dueno de la tabla,
--    independientemente de los grants de EXECUTE.
revoke execute on function public.ann_rate_limit()          from public, anon, authenticated;
revoke execute on function public.bump_event_saves()        from public, anon, authenticated;
revoke execute on function public.bump_reposts_count()      from public, anon, authenticated;
revoke execute on function public.dm_guard_update()         from public, anon, authenticated;
revoke execute on function public.grant_alpha_on_signup()   from public, anon, authenticated;
revoke execute on function public.grant_tester_on_referral() from public, anon, authenticated;
revoke execute on function public.notify_announcement()     from public, anon, authenticated;
revoke execute on function public.notify_new_dm()           from public, anon, authenticated;
revoke execute on function public.protect_profile_columns() from public, anon, authenticated;
revoke execute on function public.send_event_reminders()    from public, anon, authenticated;

-- 2) Ayudantes de DM/conversaciones usados dentro de las politicas RLS.
--    Funciones de funcionalidad que requiere inicio de sesion: se revoca el
--    EXECUTE que llegaba via PUBLIC (anon lo heredaba) y se concede de forma
--    explicita solo a `authenticated`, que es quien lo necesita para que las
--    politicas RLS puedan evaluarlas.
revoke execute on function public.dm_blocked(uuid, uuid)        from public, anon;
revoke execute on function public.dm_is_participant(uuid)       from public, anon;
revoke execute on function public.is_conv_creator(uuid, uuid)   from public, anon;
revoke execute on function public.is_conv_member(uuid, uuid)    from public, anon;

grant execute on function public.dm_blocked(uuid, uuid)      to authenticated;
grant execute on function public.dm_is_participant(uuid)     to authenticated;
grant execute on function public.is_conv_creator(uuid, uuid) to authenticated;
grant execute on function public.is_conv_member(uuid, uuid)  to authenticated;

-- NOTA: Quedan advertencias "esperadas" que NO se corrigen aqui a proposito:
--   * is_admin(), is_banned(), is_conv_*, dm_*: las usan las politicas RLS, por
--     lo que `authenticated` DEBE poder ejecutarlas. Pasarlas a SECURITY INVOKER
--     las romperia (necesitan saltarse RLS para leer otras filas).
--   * increment_plays(uuid): se invoca a proposito desde el frontend por RPC.
--   * extension pg_net en schema public: extension gestionada por Supabase.
--   * Leaked password protection: activarla desde el panel de Auth (no es SQL).
