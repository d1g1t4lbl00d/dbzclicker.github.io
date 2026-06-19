// Landing pública rica en contenido para SEO. Se sirve SOLO a buscadores y
// scrapers en la home (ver rewrite condicional por user-agent en vercel.json).
// Los usuarios normales reciben la SPA (index.html) sin cambios.
const SB = 'https://hvpycejcaljgpxwnykuh.supabase.co';
const KEY = 'sb_publishable_JySDMyA_Z1jVQPz9zrCbUA_2SvNf07M';
const BASE = 'https://underbro.app';
const LOGO = BASE + '/icon-512.png';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sbList(path) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch (_) { return []; }
}

const FAQ = [
  ['¿Qué es UnderBro?', 'UnderBro es una red social de música donde artistas independientes suben sus pistas, conectan con otros músicos y oyentes, y hacen crecer su audiencia. Es gratis.'],
  ['¿Cuánto cuesta?', 'UnderBro es gratuito. Incluye herramientas que en otras plataformas son de pago: press kit / EPK profesional, estadísticas de audiencia, programación de publicaciones y más.'],
  ['¿Cómo subo mi música?', 'Crea una cuenta gratis, pulsa el botón de subir, añade tu pista con su carátula, descripción y género, y publícala al instante o prográmala.'],
  ['¿Qué es el press kit de UnderBro?', 'Un dossier de artista (EPK) que reúne tu biografía, tus estadísticas globales de todas las plataformas (Spotify, Instagram, etc.), tus mejores pistas y tu contacto en una web compartible y descargable en PDF.'],
  ['¿Puedo conectar con otros artistas?', 'Sí. Puedes seguir a artistas, comentar, repostear, chatear por mensajes directos e incluso hacer llamadas dentro de la app.'],
];

module.exports = async (req, res) => {
  const tracks = await sbList('tracks?select=id,title,genre,profiles:user_id(username,display_name)&order=plays.desc&limit=18');

  // artistas únicos a partir de las pistas más escuchadas
  const seen = new Set(); const artists = [];
  for (const t of tracks) {
    const p = t.profiles; if (!p || !p.username || seen.has(p.username)) continue;
    seen.add(p.username); artists.push({ username: p.username, name: p.display_name || p.username });
    if (artists.length >= 12) break;
  }

  const trackLinks = tracks.slice(0, 12).map(t => {
    const who = (t.profiles && (t.profiles.display_name || t.profiles.username)) || 'Artista';
    return `<li><a href="/t/${esc(t.id)}">${esc(t.title)}</a> <span class="muted">· ${esc(who)}${t.genre ? ' · ' + esc(t.genre) : ''}</span></li>`;
  }).join('');

  const artistLinks = artists.map(a => `<li><a href="/u/${esc(a.username)}">${esc(a.name)}</a></li>`).join('');

  const faqHtml = FAQ.map(([q, a]) => `<div class="faq"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('');

  const ld = [
    { '@type': 'Organization', '@id': BASE + '/#org', name: 'UnderBro', url: BASE + '/', logo: LOGO, description: 'La red social de la música underground.' },
    { '@type': 'WebSite', '@id': BASE + '/#website', url: BASE + '/', name: 'UnderBro', publisher: { '@id': BASE + '/#org' }, inLanguage: 'es', potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: BASE + '/?q={search_term_string}' }, 'query-input': 'required name=search_term_string' } },
    { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];

  const title = 'UnderBro — La red social de la música underground';
  const desc = 'Sube tus pistas, conecta con artistas y descubre lo que está pegando. Herramientas profesionales gratis: press kit, estadísticas y más.';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${BASE}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="UnderBro">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${LOGO}">
<meta property="og:url" content="${BASE}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${LOGO}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': ld })}</script>
<link rel="icon" href="/assets/favicon-64.png">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0a0d18;color:#eaf0ff;line-height:1.6}
.wrap{max-width:920px;margin:0 auto;padding:32px 20px 64px}
header.hero{text-align:center;padding:48px 0 36px}
.hero img{width:96px;height:96px;border-radius:22px}
h1{font-size:34px;font-weight:850;margin:18px 0 8px;letter-spacing:-.02em}
.lede{font-size:18px;color:#c3cdec;max-width:620px;margin:0 auto 22px}
.cta{display:inline-block;background:linear-gradient(135deg,#3e57fc,#6f7bff);color:#fff;text-decoration:none;font-weight:700;padding:14px 30px;border-radius:999px;box-shadow:0 10px 26px rgba(62,87,252,.45)}
h2{font-size:22px;font-weight:800;margin:38px 0 14px}
h3{font-size:16px;font-weight:700;margin:0 0 4px}
section{border-top:1px solid #1d2440;padding-top:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:8px}
.feature{background:#121728;border:1px solid #232a44;border-radius:14px;padding:16px}
.feature p{margin:6px 0 0;color:#b9c4e6;font-size:14px}
ul.links{list-style:none;padding:0;margin:8px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
ul.links li{background:#121728;border:1px solid #232a44;border-radius:10px;padding:10px 12px}
a{color:#8aa0ff;text-decoration:none}
a:hover{text-decoration:underline}
.muted{color:#7e8cb5;font-size:13px}
.faq{margin:14px 0}
.faq p{margin:4px 0 0;color:#b9c4e6}
footer{border-top:1px solid #1d2440;margin-top:40px;padding-top:20px;color:#7e8cb5;font-size:14px;text-align:center}
</style>
</head><body><div class="wrap">
<header class="hero">
  <img src="/icon-192.png" alt="UnderBro" width="96" height="96">
  <h1>UnderBro</h1>
  <p class="lede">La red social de la música underground. Sube tus pistas, conecta con artistas y descubre lo que está pegando.</p>
  <a class="cta" href="/">Entrar en UnderBro</a>
</header>

<section>
  <h2>¿Qué es UnderBro?</h2>
  <p>UnderBro es una plataforma social pensada para músicos independientes y oyentes. Sube tu música, gana audiencia, conecta con otros artistas y accede a herramientas profesionales <strong>totalmente gratis</strong> — las mismas que en otras apps son de pago.</p>
</section>

<section>
  <h2>Herramientas para artistas</h2>
  <div class="grid">
    <div class="feature"><h3>Press kit / EPK</h3><p>Un dossier de artista compartible y descargable en PDF con tu biografía, estadísticas globales, mejores pistas y contacto.</p></div>
    <div class="feature"><h3>Estadísticas globales</h3><p>Reúne tus números reales de Spotify, Instagram, SoundCloud, YouTube y más en un panel profesional.</p></div>
    <div class="feature"><h3>Programar publicaciones</h3><p>Planifica el lanzamiento de tus pistas y publícalas en el momento perfecto.</p></div>
    <div class="feature"><h3>Insights de audiencia</h3><p>Descubre quién te escucha, cuándo y desde dónde, pista a pista.</p></div>
  </div>
</section>

${artistLinks ? `<section><h2>Artistas en UnderBro</h2><ul class="links">${artistLinks}</ul></section>` : ''}
${trackLinks ? `<section><h2>Pistas que están pegando</h2><ul class="links">${trackLinks}</ul></section>` : ''}

<section>
  <h2>Preguntas frecuentes</h2>
  ${faqHtml}
</section>

<footer>
  UnderBro · la red social de la música. <a href="/">Crea tu cuenta gratis</a>
</footer>
</div></body></html>`);
};
