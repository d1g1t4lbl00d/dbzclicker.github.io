# UnderBro 🎵

> **upload. share. connect.**

UnderBro es una plataforma social para **subir, compartir y descubrir música**, con
estética _glossy_ blanca/azul fiel a la guía de marca. Construida como una SPA estática
con **Supabase** (auth, base de datos, storage y realtime) y desplegada en **Vercel**.

## ✨ Funcionalidades

- **Registro e inicio de sesión** (email + contraseña) con perfil automático.
- **Subir pistas** (MP3/WAV/OGG…) con portada, título y género — almacenadas en Supabase Storage.
- **Reproductor** global con waveform, seek, control de volumen, anterior/siguiente y contador de reproducciones.
- **Feeds**: Following · Trending · New, además de biblioteca (All Tracks, Favorites, My Uploads, Downloads).
- **Me gusta / favoritos**, **comentarios** por pista y **descargas**.
- **Seguir / dejar de seguir** usuarios, página de **perfil** y directorio **People**.
- **Chat global en tiempo real** y lista de **People Online** (presencia realtime).
- **Notificaciones** (nuevos seguidores, likes y comentarios en tus pistas).
- **Ajustes** de perfil (nombre, usuario, bio y avatar).
- Diseño **responsive** con set de iconos propio (SVG).

## 🗂️ Estructura

```
index.html        Shell de la app + sprite de iconos SVG
css/styles.css    Tema glossy blanco/azul
js/config.js      URL y clave pública de Supabase
js/app.js         Lógica completa (auth, feed, player, upload, chat, presencia…)
dino.html         Mini-juego previo del repo (conservado)
vercel.json       Configuración de despliegue estático
```

## 🛠️ Backend (Supabase)

Tablas: `profiles`, `tracks`, `comments`, `likes`, `follows`, `messages` — todas con
**Row Level Security**. Buckets de Storage públicos: `tracks`, `covers`, `avatars`
(subida restringida a la carpeta del propio usuario). El chat usa Realtime sobre `messages`
y "People Online" usa Presence.

## 🛡️ Moderación

Existe una **única cuenta de administrador** (`profiles.is_admin = true`). El admin puede:
borrar cualquier pista, comentario o mensaje del chat, y **banear / desbanear** usuarios
(un usuario baneado no puede subir música, comentar ni chatear). La escalada de privilegios
está bloqueada por un trigger (`protect_profile_privileges`): ningún usuario puede asignarse
`is_admin` ni cambiar su estado de baneo; solo un admin puede hacerlo, mediante políticas RLS
de override. El cambio de contraseña está disponible en **Settings**.

## 🚀 Desarrollo local

Es un sitio estático, así que basta con servir la carpeta:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Las credenciales de Supabase en `js/config.js` son la URL del proyecto y la clave
**publishable/anon** (pública por diseño; la seguridad la imponen las políticas RLS).
