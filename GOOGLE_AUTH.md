# Activar "Continuar con Google" (Supabase + Google Cloud)

El botón ya está en la app. Falta conectar el proveedor. Dos paneles:

## 1) Google Cloud Console  (console.cloud.google.com)
1. Crea o elige un proyecto (arriba).
2. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo: **External** → Crear.
   - Nombre de la app: **UnderBro** · Correo de asistencia: tu correo.
   - Dominios autorizados: `underbro.app`
   - Guardar. (Scopes por defecto: email, profile, openid — no hacen falta sensibles.)
   - **Publicar la app** (botón "PUBLICAR APP") para que pueda entrar cualquiera. Si la dejas en "Testing", solo entran los correos que añadas como test users.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **Orígenes de JavaScript autorizados:** `https://underbro.app`
   - **URIs de redireccionamiento autorizados:**
     `https://hvpycejcaljgpxwnykuh.supabase.co/auth/v1/callback`
   - Crear → copia el **Client ID** y el **Client secret**.

## 2) Supabase Dashboard  (supabase.com/dashboard → proyecto UnderBro)
1. **Authentication → Providers → Google**:
   - Activar (Enable).
   - Pega **Client ID** y **Client Secret**.
   - Guardar.
2. **Authentication → URL Configuration**:
   - **Site URL:** `https://underbro.app`
   - **Redirect URLs** (añadir):
     - `https://underbro.app`
     - `https://underbro.app/**`

## Listo
Recarga underbro.app → pulsa **Continuar con Google** → eliges cuenta → vuelves logueado.
Al ser cuenta nueva por Google, se crea el perfil con un usuario derivado de tu correo (editable en Ajustes).

> Nota: el `Authorized redirect URI` SIEMPRE es el de Supabase
> (`.../auth/v1/callback`), no el de tu web. Es el error más común.
