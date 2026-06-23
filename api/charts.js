// Página pública de charts (Top de la semana) — indexable y compartible.
// Ruta: /charts (ver rewrite en vercel.json). Sirve HTML real con enlaces
// internos a cada pista/artista (bueno para SEO) + CTA a la app.
const SB = 'https://hvpycejcaljgpxwnykuh.supabase.co';
const KEY = 'sb_publishable_JySDMyA_Z1jVQPz9zrCbUA_2SvNf07M';
const BASE = 'https://underbro.app';
const LOGO = BASE + '/icon-512.png';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nfmt = (n) => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K'; return String(n); };

async function topTracks() {
  // intenta el ranking "hot" (últimos 7 días); si falla, cae a más reproducidas
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/trending_tracks`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_days: 7, p_limit: 20 }),
    });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) return d; }
  } catch (_) {}
  try {
    const r = await fetch(`${SB}/rest/v1/tracks?select=id,title,cover_url,plays,genre,user_id&order=plays.desc&limit=20`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (r.ok) return await r.json();
  } catch (_) {}
  return [];
}
async function profilesFor(ids) {
  if (!ids.length) return {};
  try {
    const r = await fetch(`${SB}/rest/v1/profiles?select=id,username,display_name&id=in.(${ids.join(',')})`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return {};
    const d = await r.json();
    return Object.fromEntries((d || []).map(p => [p.id, p]));
  } catch (_) { return {}; }
}

module.exports = async (req, res) => {
  let tracks = await topTracks();
  // resolver artistas (el RPC ya trae profiles embebido; el fallback no)
  const needIds = [...new Set(tracks.filter(t => !t.profiles && t.user_id).map(t => t.user_id))];
  const byId = await profilesFor(needIds);

  const rows = tracks.map((t, i) => {
    const p = t.profiles || byId[t.user_id] || {};
    const who = p.display_name || p.username || 'Artista';
    const cov = t.cover_url || LOGO;
    return `<li class="row">
      <span class="rank">${i + 1}</span>
      <a class="cov" href="/t/${esc(t.id)}"><img src="${esc(cov)}" alt="${esc(t.title || '')}" loading="lazy"></a>
      <span class="meta">
        <a class="ti" href="/t/${esc(t.id)}">${esc(t.title || 'Pista')}</a>
        <span class="ar">${p.username ? `<a href="/u/${esc(p.username)}">${esc(who)}</a>` : esc(who)}${t.genre ? ` · ${esc(t.genre)}` : ''}</span>
      </span>
      <span class="pl">${nfmt(t.plays)} ▶</span>
    </li>`;
  }).join('');

  const ld = {
    '@context': 'https://schema.org', '@type': 'MusicPlaylist', name: 'Charts de UnderBro — Top de la semana', url: BASE + '/charts',
    numTracks: tracks.length,
    track: tracks.slice(0, 20).map((t, i) => {
      const p = t.profiles || byId[t.user_id] || {};
      return { '@type': 'MusicRecording', position: i + 1, name: t.title, url: `${BASE}/t/${t.id}`, byArtist: { '@type': 'MusicGroup', name: p.display_name || p.username || 'Artista' } };
    }),
  };
  const title = 'Charts de UnderBro — Top de la semana';
  const desc = 'Las pistas que más están pegando esta semana en UnderBro. El ranking de la música underground, actualizado solo.';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}/charts">
<meta property="og:type" content="website"><meta property="og:site_name" content="UnderBro">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${LOGO}"><meta property="og:url" content="${BASE}/charts">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${LOGO}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<link rel="icon" href="/assets/favicon-64.png">
<style>
:root{color-scheme:dark}*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0a0d18;color:#eaf0ff;line-height:1.5}
.wrap{max-width:760px;margin:0 auto;padding:30px 18px 70px}
header{text-align:center;padding:30px 0 22px;border-bottom:1px solid #1d2440;margin-bottom:18px}
header img{width:70px;height:70px;border-radius:18px}
h1{font-size:30px;font-weight:900;margin:14px 0 6px;letter-spacing:-.02em}
.sub{color:#aab6da;font-size:15px;max-width:520px;margin:0 auto}
.cta{display:inline-block;margin-top:18px;background:linear-gradient(135deg,#3e57fc,#6f7bff);color:#fff;text-decoration:none;font-weight:700;padding:12px 26px;border-radius:999px;box-shadow:0 8px 22px rgba(62,87,252,.45)}
ul{list-style:none}
.row{display:flex;align-items:center;gap:14px;padding:10px 8px;border-radius:12px}
.row:hover{background:#121728}
.rank{width:26px;text-align:center;font-weight:900;font-size:17px;color:#7e8cb5;flex:none}
.row:nth-child(1) .rank,.row:nth-child(2) .rank,.row:nth-child(3) .rank{color:#8aa0ff}
.cov{width:56px;height:56px;flex:none;border-radius:9px;overflow:hidden;background:#1b2138}
.cov img{width:100%;height:100%;object-fit:cover;display:block}
.meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ti{font-weight:700;font-size:15.5px;color:#fff;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ti:hover{text-decoration:underline}
.ar{font-size:13px;color:#9fb0d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ar a{color:inherit;text-decoration:none}.ar a:hover{text-decoration:underline}
.pl{font-size:12.5px;color:#7e8cb5;font-variant-numeric:tabular-nums;flex:none}
footer{border-top:1px solid #1d2440;margin-top:26px;padding-top:22px;text-align:center;color:#7e8cb5;font-size:14px}
footer a{color:#8aa0ff;text-decoration:none}
a{color:#8aa0ff}
</style></head>
<body><div class="wrap">
<header>
  <img src="/icon-192.png" alt="UnderBro">
  <h1>Charts de UnderBro</h1>
  <p class="sub">${esc(desc)}</p>
  <a class="cta" href="/">Escúchalo gratis en UnderBro</a>
</header>
${rows ? `<ul>${rows}</ul>` : '<p style="text-align:center;color:#7e8cb5;padding:40px">Aún no hay suficientes datos para el chart. Vuelve pronto.</p>'}
<footer>Ranking actualizado automáticamente · <a href="/">UnderBro — la red social de la música</a></footer>
</div></body></html>`);
};
