// Reproductor incrustable (widget de iframe) para una pista.
// Los artistas pegan <iframe src="https://underbro.app/embed/ID"> en su
// Linktree / web / blog → backlinks y tráfico hacia UnderBro.
// Ruta: /embed/:id  (ver rewrite en vercel.json)
const SB = 'https://hvpycejcaljgpxwnykuh.supabase.co';
const KEY = 'sb_publishable_JySDMyA_Z1jVQPz9zrCbUA_2SvNf07M';
const BASE = 'https://underbro.app';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sbGet(path) {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) ? d[0] : d;
  } catch (_) { return null; }
}

module.exports = async (req, res) => {
  const id = (req.query && (req.query.track || req.query.id)) || '';
  let t = null;
  if (id) t = await sbGet(`tracks?id=eq.${encodeURIComponent(id)}&select=id,title,artist,cover_url,audio_url,genre,plays,profiles:user_id(username,display_name)`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
  // permitir que se incruste en cualquier sitio
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', 'frame-ancestors *');

  if (!t || !t.audio_url) {
    res.status(200).send(`<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:system-ui;background:#0a0d18;color:#9fb0d8;display:grid;place-items:center;height:100vh"><div style="text-align:center">Pista no disponible · <a href="${BASE}" style="color:#8aa0ff">UnderBro</a></div></body>`);
    return;
  }
  const who = (t.profiles && (t.profiles.display_name || t.profiles.username)) || t.artist || 'UnderBro';
  const uname = t.profiles && t.profiles.username;
  const trackUrl = `${BASE}/t/${encodeURIComponent(t.id)}`;
  const cover = t.cover_url || `${BASE}/icon-512.png`;

  res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)} — ${esc(who)} · UnderBro</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0c1020;color:#eaf0ff;overflow:hidden}
.wrap{display:flex;align-items:center;gap:14px;height:100%;min-height:152px;padding:14px 16px;
  background:linear-gradient(135deg,#121a30,#0a0e1c);border:1px solid #232a44;border-radius:14px}
.cover{width:118px;height:118px;flex:none;border-radius:11px;background:#1b2138 center/cover no-repeat;position:relative;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.cover img{width:100%;height:100%;object-fit:cover;display:block}
.main{flex:1;min-width:0;display:flex;flex-direction:column;height:100%;justify-content:center;gap:4px}
.brand{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.4px;color:#8aa0ff;text-transform:uppercase;text-decoration:none}
.title{font-size:18px;font-weight:800;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.title a{color:#fff;text-decoration:none}
.artist{font-size:13px;color:#9fb0d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.artist a{color:inherit;text-decoration:none}
.row{display:flex;align-items:center;gap:11px;margin-top:8px}
.play{width:46px;height:46px;flex:none;border:none;border-radius:50%;cursor:pointer;display:grid;place-items:center;
  background:linear-gradient(135deg,#3e57fc,#6f7bff);box-shadow:0 6px 18px rgba(62,87,252,.5)}
.play svg{width:20px;height:20px;fill:#fff}
.play .pause{display:none}
.wrap.playing .play .play-i{display:none}
.wrap.playing .play .pause{display:inline}
.bar{flex:1;height:6px;border-radius:4px;background:#2a3350;position:relative;cursor:pointer}
.fill{position:absolute;inset:0 auto 0 0;width:0;border-radius:4px;background:linear-gradient(90deg,#27c0ff,#3e57fc)}
.time{font-size:11px;color:#7e8cb5;font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.cta{font-size:11px;color:#8aa0ff;text-decoration:none;font-weight:700;white-space:nowrap}
.cta:hover{text-decoration:underline}
</style></head>
<body>
<div class="wrap" id="w">
  <a class="cover" href="${esc(trackUrl)}" target="_blank" rel="noopener"><img src="${esc(cover)}" alt="${esc(t.title)}"></a>
  <div class="main">
    <a class="brand" href="${esc(trackUrl)}" target="_blank" rel="noopener">▶ UnderBro</a>
    <div class="title"><a href="${esc(trackUrl)}" target="_blank" rel="noopener">${esc(t.title)}</a></div>
    <div class="artist">${uname ? `<a href="${BASE}/u/${esc(uname)}" target="_blank" rel="noopener">${esc(who)}</a>` : esc(who)}</div>
    <div class="row">
      <button class="play" id="p" aria-label="Reproducir"><svg class="play-i" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg class="pause" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg></button>
      <div class="bar" id="bar"><div class="fill" id="fill"></div></div>
      <span class="time" id="t">0:00</span>
      <a class="cta" href="${esc(trackUrl)}" target="_blank" rel="noopener">Escuchar en UnderBro</a>
    </div>
  </div>
</div>
<audio id="a" src="${esc(t.audio_url)}" preload="none"></audio>
<script>
(function(){
  var a=document.getElementById('a'),w=document.getElementById('w'),p=document.getElementById('p'),
      bar=document.getElementById('bar'),fill=document.getElementById('fill'),tt=document.getElementById('t');
  function fmt(s){s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
  p.onclick=function(){ if(a.paused){a.play();}else{a.pause();} };
  a.onplay=function(){w.classList.add('playing');};
  a.onpause=function(){w.classList.remove('playing');};
  a.onended=function(){w.classList.remove('playing');fill.style.width='0';};
  a.ontimeupdate=function(){ if(a.duration){fill.style.width=(a.currentTime/a.duration*100)+'%';} tt.textContent=fmt(a.currentTime); };
  bar.onclick=function(e){ if(!a.duration)return; var r=bar.getBoundingClientRect(); a.currentTime=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width))*a.duration; };
})();
</script>
</body></html>`);
};
