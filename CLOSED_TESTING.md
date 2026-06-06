# UnderBro · Guía de la prueba cerrada (12 testers / 14 días)

Requisito obligatorio de Google para cuentas de desarrollador **personales** nuevas:
necesitas **≥ 12 testers** que **acepten la prueba** y permanezcan **14 días seguidos**
antes de poder solicitar el paso a **producción**.

> App: **UnderBro** · Package: **`app.underbro.twa`** · Web: **https://underbro.app**

---

## Antes de empezar (requisitos)
- [ ] Cuenta de Google Play **aprobada** (verificación de identidad superada).
- [ ] **`.aab`** generado en PWABuilder (`https://underbro.app` → Android Package).
- [ ] Tener a mano **12+ correos de testers** (Gmail preferiblemente).
- [ ] URL de política: **https://underbro.app/privacy**

---

## Paso 1 · Crear la app en Play Console
1. Play Console → **Crear app**.
2. Nombre: **UnderBro** · Idioma por defecto: Español · Tipo: **App** · Gratis.
3. Acepta las declaraciones.

## Paso 2 · Rellenar lo mínimo obligatorio (panel "Configura tu app")
- **Acceso a la app:** "Toda la funcionalidad está disponible sin restricciones" (o crea una cuenta de prueba si lo piden).
- **Anuncios:** No contiene anuncios.
- **Clasificación de contenido:** rellena el cuestionario IARC (red social con contenido de usuarios y chat; con herramientas de **reportar/bloquear**).
- **Público objetivo:** 13+ (no dirigida a niños).
- **Data safety:** declara que recoges email (cuenta), contenido de usuario (audio/fotos/mensajes) e identificadores de perfil; cifrado en tránsito: sí; el usuario puede pedir borrado: sí.
- **Política de privacidad:** `https://underbro.app/privacy`

## Paso 3 · Crear la pista de prueba cerrada
1. Menú izquierdo → **Pruebas → Pruebas cerradas**.
2. Usa la pista **"Closed testing"** (o crea una nueva) → **Crear versión**.
3. Sube el **`.aab`**. Activa **Play App Signing** (lo ofrece automáticamente).
4. Notas de la versión (ej.): `Primera versión de prueba de UnderBro.`
5. **Guardar → Revisar → Iniciar lanzamiento en pruebas cerradas.**

> ⚠️ Tras subir el `.aab`, copia la **huella SHA-256** de **Play App Signing**
> (Configuración → Integridad de la app) y pásamela: la pego en
> `/.well-known/assetlinks.json` para que el TWA abra **sin barra de URL**.

## Paso 4 · Lista de testers + enlace
1. En la pista de pruebas cerradas → pestaña **Testers**.
2. Crea una **lista de correo** y añade los **12+ correos**.
3. Copia el **enlace de aceptación** ("opt-in URL"), del tipo:
   `https://play.google.com/apps/testing/app.underbro.twa`
4. Envía ese enlace a tus testers (mensaje listo abajo).

## Paso 5 · Que los testers acepten e instalen
Cada tester debe:
1. Abrir el **enlace** con la **misma cuenta de Google** cuyo correo añadiste.
2. Pulsar **"Become a tester / Convertirme en tester"**.
3. Instalar desde el enlace de Play que aparece (o buscar la app ya como tester).
4. **No desinstalarla** durante los 14 días.

## Paso 6 · Esperar 14 días y pedir producción
- Mantén **≥ 12 testers aceptados** durante **14 días seguidos**.
- Luego: **Pruebas → Producción → "Solicitar acceso a producción"** (aparece un formulario cuando cumples el requisito).
- Aprobado eso, ya puedes lanzar al público.

---

## 📣 Mensaje para los testers (copia y pega)

**Versión corta (WhatsApp/Telegram):**
> ¡Eh! Estoy lanzando mi app, **UnderBro** (red social de música underground) y necesito
> probadores antes de publicarla en Google Play. Solo tienes que:
> 1) Abrir este enlace en tu móvil Android (con tu cuenta de Google):
> 👉 [ENLACE_DE_PRUEBA]
> 2) Pulsar "Convertirme en tester" e instalar la app.
> 3) Dejarla instalada y trastear un poco estos días.
> ¡Gracias, me ayudas un montón! 🙌

**Versión email:**
> Asunto: Prueba UnderBro antes de su lanzamiento 🎵
>
> Hola:
> Estoy a punto de publicar **UnderBro**, una red social para música underground, y para
> poder sacarla en Google Play necesito un grupo de probadores durante un par de semanas.
>
> Cómo unirte (5 minutos, móvil Android):
> 1. Abre este enlace con tu cuenta de Google: [ENLACE_DE_PRUEBA]
> 2. Pulsa "Convertirme en tester".
> 3. Instala UnderBro desde el enlace de Google Play que verás.
> 4. Déjala instalada y úsala de vez en cuando estos días.
>
> Si ves algún fallo o algo mejorable, respóndeme a este correo. ¡Gracias por la ayuda!

---

## ✅ Qué pedir que prueben (y tú revisar) estos 14 días
- [ ] La app **instala** y abre **a pantalla completa** (sin barra de navegador → confirma que el `assetlinks` está bien).
- [ ] **Registro / inicio de sesión** funciona.
- [ ] **Subir** una pista y una foto.
- [ ] **Reproducir** audio; el reproductor sigue al cambiar de pantalla.
- [ ] **Chat**: enviar texto, **nota de voz**, foto, responder, reaccionar.
- [ ] **Notificaciones push** llegan con la app cerrada.
- [ ] **Bloquear** y **reportar** funcionan.
- [ ] El **splash** y el icono se ven bien.
- [ ] Nada de **cierres inesperados**.

---

## Consejos para no perder tiempo
- Apunta a **15 testers**, no 12 justos (siempre hay quien no acepta).
- Diles explícitamente que **acepten el enlace** (no basta con instalar): Google cuenta los que **opt-in**.
- Que usen la **misma cuenta de Google** del correo que añadiste.
- No reinicies la pista ni quites testers a mitad: el contador de 14 días podría reiniciarse.
- Cualquier cambio en la **web** se refleja solo en la app (TWA); no hace falta resubir el `.aab` salvo cambios de icono/nombre/permisos.
