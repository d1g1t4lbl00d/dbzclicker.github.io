// Página de "preview/landing" para enlaces compartidos y para SEO.
// - Buscadores y scrapers (Google, WhatsApp, etc.): reciben HTML real con
//   contenido + Open Graph + JSON-LD (indexable), sin redirección.
// - Humanos (navegador normal): se les abre la app directamente.
// Rutas: /t/:id (pista), /u/:username (artista), /p/:id (foto), /pl/:id (playlist).
const SB = 'https://hvpycejcaljgpxwnykuh.supabase.co';
const KEY = 'sb_publishable_JySDMyA_Z1jVQPz9zrCbUA_2SvNf07M';
const BASE = 'https://underbro.app';
const LOGO = BASE + '/icon-512.png';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sbGet(path) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) ? d[0] : d;
  } catch (_) { return null; }
}
async function sbList(path) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch (_) { return []; }
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  // bots de buscadores y scrapers sociales: NO redirigir, servir contenido.
  const isBot = !ua || /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora|pinterest|vkshare|whatsapp|telegram|telegrambot|discord|twitterbot|linkedinbot|google|lighthouse|headlesschrome|applebot|yandex|baidu|duckduck|preview/i.test(ua);

  let title = 'UnderBro', desc = 'Sube, comparte y conecta a través de la música underground.';
  let image = LOGO, appUrl = '/', canonical = BASE + '/', type = 'website';
  let ld = null, bodyMain = '', sub = '', extra = '';

  try {
    if (q.track) {
      const t = await sbGet(`tracks?id=eq.${encodeURIComponent(q.track)}&select=title,artist,cover_url,genre,description,profiles:user_id(display_name,username)`);
      if (t) {
        const who = (t.profiles && (t.profiles.display_name || t.profiles.username)) || t.artist || 'UnderBro';
        const uname = t.profiles && t.profiles.username;
        title = `${t.title} — ${who}`;
        desc = t.description || `Escucha "${t.title}" de ${who} en UnderBro.`;
        image = t.cover_url || LOGO; type = 'music.song';
        sub = `${esc(who)}${t.genre ? ' · ' + esc(t.genre) : ''}`;
        if (uname) extra = `<a class="lk" href="/u/${esc(uname)}">Ver perfil de ${esc(who)}</a>`;
        ld = { '@context': 'https://schema.org', '@type': 'MusicRecording', name: t.title, byArtist: { '@type': 'MusicGroup', name: who }, image, url: `${BASE}/t/${q.track}`, genre: t.genre || undefined, description: desc };
      }
      appUrl = `/?track=${encodeURIComponent(q.track)}`;
      canonical = `${BASE}/t/${encodeURIComponent(q.track)}`;
    } else if (q.artist) {
      const p = await sbGet(`profiles?username=eq.${encodeURIComponent(q.artist)}&select=id,username,display_name,avatar_url,bio`);
      if (p) {
        const who = p.display_name || p.username;
        title = `${who} — UnderBro`;
        desc = (p.bio && p.bio.slice(0, 200)) || `Escucha a ${who} en UnderBro: pistas, novedades y más.`;
        image = p.avatar_url || LOGO; type = 'profile';
        sub = `@${esc(p.username)}`;
        const tracks = await sbList(`tracks?user_id=eq.${encodeURIComponent(p.id)}&select=id,title,genre&order=plays.desc&limit=8`);
        if (tracks.length) {
          extra = `<h2 class="h2">Pistas</h2><ul class="tl">` + tracks.map(t => `<li><a class="lk" href="/t/${esc(t.id)}">${esc(t.title)}</a>${t.genre ? ` <span class="g">${esc(t.genre)}</span>` : ''}</li>`).join('') + `</ul>`;
        }
        ld = { '@context': 'https://schema.org', '@type': 'MusicGroup', name: who, alternateName: p.username, image, url: `${BASE}/u/${p.username}`, description: desc };
      }
      appUrl = `/?u=${encodeURIComponent(q.artist)}`;
      canonical = `${BASE}/u/${encodeURIComponent(q.artist)}`;
    } else if (q.post) {
      const p = await sbGet(`posts?id=eq.${encodeURIComponent(q.post)}&select=caption,image_url,profiles:user_id(display_name,username)`);
      if (p) { const who = (p.profiles && (p.profiles.display_name || p.profiles.username)) || 'UnderBro'; title = `Foto de ${who}`; desc = p.caption || `Mira esta foto de ${who} en UnderBro.`; image = p.image_url || LOGO; sub = esc(who); }
      appUrl = `/?post=${encodeURIComponent(q.post)}`;
      canonical = `${BASE}/p/${encodeURIComponent(q.post)}`;
    } else if (q.playlist) {
      const pl = await sbGet(`playlists?id=eq.${encodeURIComponent(q.playlist)}&select=title,description,profiles:user_id(display_name,username)`);
      if (pl) { const who = (pl.profiles && (pl.profiles.display_name || pl.profiles.username)) || 'UnderBro'; title = `${pl.title} — playlist de ${who}`; desc = pl.description || `Playlist de ${who} en UnderBro.`; sub = `Playlist · ${esc(who)}`; ld = { '@context': 'https://schema.org', '@type': 'MusicPlaylist', name: pl.title, url: `${BASE}/pl/${q.playlist}`, description: desc }; }
      appUrl = `/?playlist=${encodeURIComponent(q.playlist)}`;
      canonical = `${BASE}/pl/${encodeURIComponent(q.playlist)}`;
    }
  } catch (_) {}

  const hasCover = image && image !== LOGO;
  bodyMain = `
    <main class="card">
      <div class="cover"${hasCover ? ` style="background-image:url('${esc(image)}')"` : ''}>${hasCover ? '' : '<img src="/icon-192.png" alt="UnderBro" width="84" height="84">'}</div>
      <h1 class="h1">${esc(title.replace(/ — UnderBro$/, ''))}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
      <p class="desc">${esc(desc)}</p>
      <a class="cta" href="${esc(appUrl)}">▶ Abrir en UnderBro</a>
      ${extra}
      <p class="foot">UnderBro · la red social de la música. <a class="lk" href="/">Descúbrela</a></p>
    </main>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
  res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
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
${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}
<link rel="icon" href="/assets/favicon-64.png">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0a0d18;color:#eaf0ff;min-height:100vh;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:460px;background:#121728;border:1px solid #232a44;border-radius:20px;padding:24px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.cover{width:180px;height:180px;margin:0 auto 18px;border-radius:16px;background:#1b2138 center/cover no-repeat;display:grid;place-items:center}
.h1{font-size:22px;font-weight:800;margin:0 0 4px;line-height:1.2}
.sub{color:#9fb0d8;font-size:14px;margin:0 0 12px;font-weight:600}
.desc{color:#c3cdec;font-size:14px;line-height:1.5;margin:0 0 18px}
.cta{display:inline-block;background:linear-gradient(135deg,#3e57fc,#6f7bff);color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:999px;box-shadow:0 8px 22px rgba(62,87,252,.45)}
.h2{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:#9fb0d8;margin:24px 0 8px}
.tl{list-style:none;padding:0;margin:0;text-align:left}
.tl li{padding:10px 12px;border:1px solid #232a44;border-radius:10px;margin-bottom:7px}
.tl .g{color:#7e8cb5;font-size:12px}
.lk{color:#8aa0ff;text-decoration:none}
.lk:hover{text-decoration:underline}
.foot{margin:22px 0 0;font-size:12px;color:#7e8cb5}
</style>
${isBot ? '' : `<script>location.replace(${JSON.stringify(appUrl)});</script>`}
</head><body>${bodyMain}</body></html>`);
};
