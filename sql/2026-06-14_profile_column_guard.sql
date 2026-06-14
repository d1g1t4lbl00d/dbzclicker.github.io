-- =============================================================================
-- UnderBro · Blindaje de columnas sensibles de profiles (anti escalada)
-- -----------------------------------------------------------------------------
-- La política RLS profiles_update permite a un usuario actualizar SU PROPIA fila
-- (necesario para editar bio, avatar, tema…). Sin un guard, un usuario malicioso
-- podría hacer update({ is_admin:true }) sobre su propia fila desde la consola.
-- Este trigger BEFORE UPDATE fuerza que las columnas sensibles (is_admin,
-- verified, banned) SOLO las pueda cambiar un admin; para el resto se conservan
-- los valores anteriores. Idempotente: se puede ejecutar varias veces.
-- Ejecútalo en el SQL Editor.
-- =============================================================================

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    NEW.is_admin := OLD.is_admin;
    NEW.verified := OLD.verified;
    NEW.banned   := OLD.banned;
  end if;
  return NEW;
end;
$$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

revoke execute on function public.protect_profile_columns() from public, anon, authenticated;

-- Comprobación rápida (debe devolver 1 fila):
--   select tgname from pg_trigger where tgname = 'protect_profile_columns';
