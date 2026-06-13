// Página de "preview" para compartir: cuando WhatsApp/Twitter/IG piden el enlace,
// devuelve metadatos Open Graph (carátula, título, artista) y redirige a la app
// a los humanos. Rutas: /t/:id (pista), /p/:id (foto), /pl/:id (playlist).
const SB = 'https://hvpycejcaljgpxwnykuh.supabase.co';
const KEY = 'sb_publishable_JySDMyA_Z1jVQPz9zrCbUA_2SvNf07M';
const LOGO = 'https://underbro.app/icon-512.png';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sbGet(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) return null;
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  let title = 'UnderBro', desc = 'Sube, comparte y conecta a través de la música underground.', image = LOGO, appUrl = '/', type = 'website';
  try {
    if (q.track) {
      const t = await sbGet(`tracks?id=eq.${encodeURIComponent(q.track)}&select=title,artist,cover_url,profiles:user_id(display_name,username)`);
      if (t) { const who = (t.profiles && (t.profiles.display_name || t.profiles.username)) || t.artist || 'UnderBro'; title = `${t.title} — ${who}`; desc = `Escucha "${t.title}" de ${who} en UnderBro.`; image = t.cover_url || LOGO; type = 'music.song'; }
      appUrl = `/?track=${encodeURIComponent(q.track)}`;
    } else if (q.post) {
      const p = await sbGet(`posts?id=eq.${encodeURIComponent(q.post)}&select=caption,image_url,profiles:user_id(display_name,username)`);
      if (p) { const who = (p.profiles && (p.profiles.display_name || p.profiles.username)) || 'UnderBro'; title = `Foto de ${who}`; desc = p.caption || `Mira esta foto de ${who} en UnderBro.`; image = p.image_url || LOGO; }
      appUrl = `/?post=${encodeURIComponent(q.post)}`;
    } else if (q.playlist) {
      const pl = await sbGet(`playlists?id=eq.${encodeURIComponent(q.playlist)}&select=title,description,profiles:user_id(display_name,username)`);
      if (pl) { const who = (pl.profiles && (pl.profiles.display_name || pl.profiles.username)) || 'UnderBro'; title = `${pl.title} — playlist de ${who}`; desc = pl.description || `Playlist de ${who} en UnderBro.`; }
      appUrl = `/?playlist=${encodeURIComponent(q.playlist)}`;
    }
  } catch (_) {}
  const canonical = 'https://underbro.app' + appUrl;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="UnderBro">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head><body style="font-family:system-ui;background:#0a0d18;color:#fff;display:grid;place-items:center;height:100vh;margin:0">Abriendo UnderBro…</body></html>`);
};
