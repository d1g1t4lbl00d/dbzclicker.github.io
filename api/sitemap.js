// Sitemap dinámico: lista artistas, pistas y playlists públicas para Google.
// Se sirve en /sitemap.xml (ver rewrite en vercel.json).
const SB = 'https://hvpycejcaljgpxwnykuh.supabase.co';
const KEY = 'sb_publishable_JySDMyA_Z1jVQPz9zrCbUA_2SvNf07M';
const BASE = 'https://underbro.app';

const escXml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

async function sbGet(path) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch (_) { return []; }
}

function urlNode(loc, lastmod, priority, changefreq) {
  return `<url><loc>${escXml(loc)}</loc>${lastmod ? `<lastmod>${escXml(String(lastmod).slice(0, 10))}</lastmod>` : ''}${changefreq ? `<changefreq>${changefreq}</changefreq>` : ''}${priority ? `<priority>${priority}</priority>` : ''}</url>`;
}

module.exports = async (req, res) => {
  const [tracks, artists, playlists] = await Promise.all([
    sbGet('tracks?select=id,created_at&order=created_at.desc&limit=5000'),
    sbGet('profiles?select=username,created_at&username=not.is.null&order=created_at.desc&limit=5000'),
    sbGet('playlists?select=id,created_at&order=created_at.desc&limit=2000'),
  ]);

  const nodes = [];
  // páginas fijas
  nodes.push(urlNode(BASE + '/', null, '1.0', 'daily'));
  nodes.push(urlNode(BASE + '/charts', null, '0.9', 'daily'));
  // artistas
  for (const a of artists) {
    if (!a.username) continue;
    nodes.push(urlNode(`${BASE}/u/${encodeURIComponent(a.username)}`, a.created_at, '0.8', 'weekly'));
  }
  // pistas
  for (const t of tracks) {
    nodes.push(urlNode(`${BASE}/t/${encodeURIComponent(t.id)}`, t.created_at, '0.7', 'weekly'));
  }
  // playlists
  for (const pl of playlists) {
    nodes.push(urlNode(`${BASE}/pl/${encodeURIComponent(pl.id)}`, pl.created_at, '0.5', 'weekly'));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${nodes.join('\n')}\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
