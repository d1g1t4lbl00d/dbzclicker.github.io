# UnderBro · Guía de publicación en Google Play

App web (PWA) → empaquetada como **TWA** (Trusted Web Activity) sobre el dominio **https://underbro.app**.

---

## 0) Estado de preparación (ya hecho ✅)

- [x] PWA instalable: `manifest.json` con `name`, `start_url`/`scope` `/`, `display: standalone`, `theme/background_color`.
- [x] Iconos `any` **y** `maskable` (192 y 512) generados desde el logo.
- [x] Service worker (`/sw.js`) para push.
- [x] `.nojekyll` para que GitHub Pages publique `/.well-known/`.
- [x] `/.well-known/assetlinks.json` (falta pegar la huella SHA-256, ver paso 3).
- [x] Política de privacidad pública: **https://underbro.app/privacy.html**
- [x] Moderación UGC: bloquear usuarios + reportar contenido + panel de reportes (requisito Play).

Falta (acciones tuyas, fuera del código): dominio activo, cuenta Play, generar `.aab`, fichas y formularios.

---

## 1) Dominio y hosting ✅ (ya hecho)

- La app se sirve en **Vercel** (proyecto `dbzclicker-github-io`), conectado al repo de GitHub.
- **https://underbro.app** ya está activo con HTTPS y sirve la última versión.
- **Auto-deploy:** cada push a `main` despliega a producción automáticamente.
- Vercel sirve la app en la **raíz** del dominio → rutas absolutas (`/manifest.json`, `/sw.js`, `/.well-known/`) correctas y PWA instalable.

> No se usa GitHub Pages para el dominio; no hace falta `CNAME` ni registros DNS manuales.

---

## 2) Cuenta y empaquetado

1. Crea la **Google Play Developer account** (pago único 25 USD): https://play.google.com/console
2. Genera el paquete TWA con **PWABuilder**: https://www.pwabuilder.com
   - Introduce `https://underbro.app`.
   - Pestaña **Android Package** → Package ID sugerido: **`app.underbro.twa`** (debe coincidir con `assetlinks.json`).
   - Descarga el `.aab` (App Bundle) y el `.apk` de prueba.
   - PWABuilder genera también un `assetlinks.json` con la huella; si usas Play App Signing, usa la huella de Play (paso 3).

---

## 3) Digital Asset Links (quita la barra de URL)

1. En Play Console → tu app → **Configuración → Integridad de la app / Firma de apps** copia el **SHA-256 certificate fingerprint** (de *App signing key certificate*).
2. Pega esa huella en `/.well-known/assetlinks.json` reemplazando `REEMPLAZAR_CON_LA_HUELLA_SHA256_DE_PLAY_APP_SIGNING`.
3. Verifica que carga: `https://underbro.app/.well-known/assetlinks.json` (debe devolver el JSON, no 404).
4. Comprueba con: https://developers.google.com/digital-asset-links/tools/generator

---

## 4) Ficha de Play Store (qué preparar)

- **Nombre:** UnderBro
- **Descripción breve / completa:** (sube, comparte y conecta a través de la música underground).
- **Icono 512×512:** usa `icon-512.png`.
- **Gráfico destacado 1024×500.**
- **Capturas:** mín. 2 (teléfono). Puedes usar las pantallas de stream, perfil y chat.
- **Categoría:** Música y audio (o Social).
- **Política de privacidad (URL):** `https://underbro.app/privacy`
- **Correo de contacto:** `underbroapp@gmail.com` (el mismo que aparece en privacy.html).

---

## 5) Formularios obligatorios

- **Data safety:** declara que recoges **email** (cuenta), **contenido de usuario** (audio, fotos, mensajes), **identificadores** (perfil). Cifrado en tránsito: sí. El usuario puede solicitar borrado: sí (Ajustes → Eliminar cuenta).
- **Clasificación de contenido (IARC):** rellena el cuestionario; es una red social con contenido generado por usuarios y chat → marca interacción entre usuarios / contenido sin moderar previamente, con herramientas de reporte y bloqueo.
- **App content:** público objetivo (no dirigida a menores de 13), anuncios: no.

---

## 6) Requisito de testing (cuentas personales nuevas)

Si tu cuenta de desarrollador es **personal** y se creó después de nov-2023:
- Debes correr una **prueba cerrada** con **mín. 12 testers** durante **14 días** antes de poder solicitar producción.
- Crea una pista de **Closed testing**, sube el `.aab`, invita a 12+ correos y mantén la prueba 14 días.

---

## 7) Notas

- El **push** ya funciona dentro de la TWA (web push + service worker).
- Cada cambio en la web se refleja automáticamente en la app (la TWA carga la web en vivo); no hace falta resubir el `.aab` salvo cambios de icono/nombre/permisos.
