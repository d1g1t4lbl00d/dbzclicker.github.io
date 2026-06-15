/* UnderBro · Editor de apariencia (solo admin). Control fino de fondo, colores,
   tipografía, formas, marca, orden de pestañas/menú y biblioteca de imágenes.
   Publica en site_config; la app principal lo aplica para todos. */
(() => {
'use strict';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.UNDERBRO_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const BUCKET = 'site-assets';

const NAV = [['feed','Stream'],['feed-trending','Trending'],['radio','Radio'],['beats','Beats'],['events','Eventos'],['posts','Fotos'],['people',"Bro's"],['all','All Tracks'],['favorites','Favorites'],['playlists','Playlists'],['ecosystems','Ecosystems'],['downloads','Downloads'],['messages','Chats'],['notifications','Notifications'],['settings','Settings']];
const TABS = [['following','Following'],['trending','Trending'],['new','New']];
const COLORS = [
  ['accent','Acento','#5f9bff'], ['accent2','Acento 2 (degradado)','#6e2df5'],
  ['ink','Texto principal','#e7ebf3'], ['ink2','Texto secundario','#cdd5e4'], ['inkSoft','Texto tenue','#8a94aa'],
  ['panel','Paneles','#121726'], ['panel2','Paneles secundarios','#1a2033'], ['line','Bordes','#232b40'], ['appbg','Fondo base','#0a0d18'],
];
const SITE_FONTS = { Poppins:'Poppins', Inter:'Inter', Montserrat:'Montserrat', Roboto:'Roboto', Nunito:'Nunito', Lato:'Lato', 'DM Sans':'DM Sans', 'Space Grotesk':'Space Grotesk', Oswald:'Oswald', 'Playfair Display':'Playfair Display' };

let cfg = defaults();
function defaults() { return { bg: { mode: 'default', dim: 0 }, colors: {}, font: { family: 'system' }, radius: null, name: '', tagline: '', logo: '', tabs: { order: [], hidden: [] }, nav: { order: [], hidden: [] } }; }
function mergeCfg(l) {
  const colors = (l.colors && typeof l.colors === 'object') ? { ...l.colors } : {};
  if (l.accent && !colors.accent) colors.accent = l.accent;
  return {
    bg: Object.assign({ mode: 'default', dim: 0 }, l.bg || {}),
    colors,
    font: { family: (l.font && l.font.family) || 'system' },
    radius: (l.radius != null) ? +l.radius : null,
    name: l.name || '', tagline: l.tagline || '', logo: l.logo || '',
    tabs: { order: (l.tabs && l.tabs.order) || [], hidden: (l.tabs && l.tabs.hidden) || [] },
    nav: { order: (l.nav && l.nav.order) || [], hidden: (l.nav && l.nav.hidden) || [] },
  };
}
const msg = (t) => { $('msg').textContent = t || ''; };
const libMsg = (t) => { $('libMsg').textContent = t || ''; };
function gate(text, link) { $('gate').innerHTML = `<div><div class="logo" style="font-size:34px;margin-bottom:10px">Under<span class="u">Bro</span></div><p>${text}</p>${link ? '<p><a href="/">Ir a la app</a></p>' : ''}</div>`; }

function loadFont(name) {
  if (!name || name === 'system' || !SITE_FONTS[name]) return null;
  const id = 'site-font-link';
  let link = document.getElementById(id);
  const href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:wght@400;500;600;700;800&display=swap`;
  if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link); }
  if (link.href !== href) link.href = href;
  return `'${SITE_FONTS[name]}', system-ui, sans-serif`;
}
function bgValue(bg) {
  if (!bg) return '';
  if (bg.mode === 'color' && bg.color) return bg.color;
  if (bg.mode === 'gradient' && bg.c1 && bg.c2) return `linear-gradient(${bg.angle != null ? bg.angle : 135}deg, ${bg.c1}, ${bg.c2})`;
  if (bg.mode === 'image' && bg.image) { const d = Math.max(0, Math.min(85, +bg.dim || 0)) / 100; return `${d ? `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})),` : ''}#0a0d18 url("${String(bg.image).replace(/["\\]/g, '')}") center/cover`; }
  return '';
}

/* ---- vista previa ---- */
function render() {
  const pv = $('pv');
  pv.style.setProperty('--blue', cfg.colors.accent || '#5f9bff');
  pv.style.setProperty('--ink', cfg.colors.ink || '#e7ebf3');
  pv.style.setProperty('--ink-2', cfg.colors.ink2 || '#cdd5e4');
  pv.style.setProperty('--ink-soft', cfg.colors.inkSoft || '#8a94aa');
  pv.style.setProperty('--panel-2', cfg.colors.panel2 || cfg.colors.panel || '#1a2033');
  pv.style.setProperty('--line', cfg.colors.line || '#232b40');
  pv.style.setProperty('--bg', cfg.colors.appbg || '#0a0d18');
  pv.style.setProperty('--pvr', (cfg.radius != null ? cfg.radius : 14) + 'px');
  pv.style.setProperty('--pvfont', loadFont(cfg.font.family) || 'inherit');
  $('pvName').innerHTML = cfg.logo ? `<img src="${cfg.logo}" alt="">` : ((cfg.name && cfg.name.trim()) || 'UnderBro');
  $('pvTagline').textContent = (cfg.tagline && cfg.tagline.trim()) || 'upload. share. connect.';
  $('pvMain').style.background = bgValue(cfg.bg) || 'transparent';
  const tl = Object.fromEntries(TABS), nl = Object.fromEntries(NAV);
  const tabs = (cfg.tabs.order.length ? cfg.tabs.order : TABS.map((c) => c[0])).filter((k) => !(cfg.tabs.hidden || []).includes(k));
  $('pvTabs').innerHTML = tabs.map((k, i) => `<span class="${i === Math.min(1, tabs.length - 1) ? 'on' : ''}">${tl[k] || k}</span>`).join('');
  const navs = (cfg.nav.order.length ? cfg.nav.order : NAV.map((c) => c[0])).filter((k) => !(cfg.nav.hidden || []).includes(k)).slice(0, 9);
  $('pvNav').innerHTML = navs.map((k, i) => `<span class="${i === 0 ? 'on' : ''}">${nl[k] || k}</span>`).join('');
}

/* ---- listas reordenables ---- */
function renderOrderList(containerId, catalog, conf) {
  const keys = catalog.map((c) => c[0]);
  let order = (conf.order && conf.order.length) ? conf.order.filter((k) => keys.includes(k)) : [];
  keys.forEach((k) => { if (!order.includes(k)) order.push(k); });
  conf.order = order;
  const hidden = new Set(conf.hidden || []);
  const labels = Object.fromEntries(catalog);
  const cont = $(containerId); cont.innerHTML = '';
  order.forEach((k, i) => {
    const row = document.createElement('div');
    row.className = 'ord-item' + (hidden.has(k) ? ' hidden-it' : '');
    row.innerHTML = `<button data-up ${i === 0 ? 'disabled' : ''}>↑</button><button data-down ${i === order.length - 1 ? 'disabled' : ''}>↓</button><span class="nm">${labels[k]}</span><label><input type="checkbox" ${hidden.has(k) ? '' : 'checked'}></label>`;
    row.querySelector('[data-up]').onclick = () => { if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; conf.order = order; renderOrderList(containerId, catalog, conf); render(); } };
    row.querySelector('[data-down]').onclick = () => { if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; conf.order = order; renderOrderList(containerId, catalog, conf); render(); } };
    row.querySelector('input').onchange = (e) => { if (e.target.checked) hidden.delete(k); else hidden.add(k); conf.hidden = [...hidden]; row.classList.toggle('hidden-it', !e.target.checked); render(); };
    cont.appendChild(row);
  });
}
function buildLists() { renderOrderList('tabsList', TABS, cfg.tabs); renderOrderList('navList', NAV, cfg.nav); }

function buildColorList() {
  const cont = $('colorList'); cont.innerHTML = '';
  COLORS.forEach(([key, label, def]) => {
    const on = cfg.colors[key] != null;
    const row = document.createElement('div'); row.className = 'clr-row';
    row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}><input type="color" value="${cfg.colors[key] || def}" ${on ? '' : 'disabled'}><span class="nm">${label}</span>`;
    const [chk, clr] = row.querySelectorAll('input');
    chk.onchange = () => { if (chk.checked) { cfg.colors[key] = clr.value; clr.disabled = false; } else { delete cfg.colors[key]; clr.disabled = true; } render(); };
    clr.oninput = () => { if (chk.checked) { cfg.colors[key] = clr.value; render(); } };
    cont.appendChild(row);
  });
}

/* ---- imágenes ---- */
async function uploadImage(file, setMsg) {
  if (!file) return null;
  setMsg && setMsg('Subiendo…');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: '31536000', upsert: false });
  if (error) { setMsg && setMsg(/bucket|not found|exist|policy|row-level/i.test(error.message || '') ? 'Falta el bucket site-assets (ejecuta el SQL).' : 'Error: ' + error.message); return null; }
  setMsg && setMsg('Subida ✓');
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
function setBgImage(url) {
  cfg.bg.mode = 'image'; cfg.bg.image = url;
  document.querySelectorAll('#bgMode button').forEach((x) => x.classList.toggle('on', x.dataset.m === 'image'));
  showBgPanels(); $('bgImageV').value = url; render();
}
async function loadLibrary() {
  const grid = $('libGrid');
  const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<p class="hint">${/bucket|not found/i.test(error.message || '') ? 'Crea el bucket site-assets (ejecuta el SQL).' : error.message}</p>`; return; }
  const imgs = (data || []).filter((o) => o.name && !o.name.startsWith('.'));
  if (!imgs.length) { grid.innerHTML = '<p class="hint">Aún no has subido imágenes.</p>'; return; }
  grid.innerHTML = '';
  imgs.forEach((o) => {
    const url = sb.storage.from(BUCKET).getPublicUrl(o.name).data.publicUrl;
    const el = document.createElement('div'); el.className = 'lib-it';
    el.innerHTML = `<img src="${url}" loading="lazy"><div class="ov"><button data-a="bg">Fondo</button><button data-a="logo">Logo</button><button data-a="copy">Copiar URL</button><button class="del" data-a="del">Borrar</button></div>`;
    el.querySelector('[data-a="bg"]').onclick = () => { setBgImage(url); libMsg('Aplicado como fondo (recuerda Publicar).'); };
    el.querySelector('[data-a="logo"]').onclick = () => { cfg.logo = url; $('logoV').value = url; render(); libMsg('Aplicado como logo (recuerda Publicar).'); };
    el.querySelector('[data-a="copy"]').onclick = () => { (navigator.clipboard && navigator.clipboard.writeText(url)); libMsg('URL copiada ✓'); };
    el.querySelector('[data-a="del"]').onclick = async () => { if (!confirm('¿Borrar esta imagen del almacenamiento?')) return; await sb.storage.from(BUCKET).remove([o.name]); loadLibrary(); };
    grid.appendChild(el);
  });
}

/* ---- controles ---- */
function showBgPanels() { $('bgColor').style.display = cfg.bg.mode === 'color' ? '' : 'none'; $('bgGrad').style.display = cfg.bg.mode === 'gradient' ? '' : 'none'; $('bgImage').style.display = cfg.bg.mode === 'image' ? '' : 'none'; }
function hydrateControls() {
  const m = cfg.bg.mode || 'default';
  document.querySelectorAll('#bgMode button').forEach((x) => x.classList.toggle('on', x.dataset.m === m));
  showBgPanels();
  if (cfg.bg.color) $('bgColorV').value = cfg.bg.color;
  if (cfg.bg.c1) $('bgC1').value = cfg.bg.c1;
  if (cfg.bg.c2) $('bgC2').value = cfg.bg.c2;
  if (cfg.bg.angle != null) $('bgAngle').value = cfg.bg.angle;
  if (cfg.bg.image) $('bgImageV').value = cfg.bg.image;
  $('bgDim').value = cfg.bg.dim || 0; $('bgDimL').textContent = (cfg.bg.dim || 0) + '%';
  $('fontV').value = cfg.font.family || 'system';
  const ro = cfg.radius != null;
  $('radiusOn').checked = ro; $('radiusV').disabled = !ro; $('radiusV').value = ro ? cfg.radius : 14; $('radiusL').textContent = (ro ? cfg.radius : 14) + 'px';
  $('nameV').value = cfg.name || ''; $('taglineV').value = cfg.tagline || ''; $('logoV').value = cfg.logo || '';
}
function wire() {
  document.querySelectorAll('#bgMode button').forEach((b) => b.onclick = () => { document.querySelectorAll('#bgMode button').forEach((x) => x.classList.toggle('on', x === b)); cfg.bg.mode = b.dataset.m; showBgPanels(); render(); });
  $('bgColorV').oninput = (e) => { cfg.bg.color = e.target.value; render(); };
  $('bgC1').oninput = (e) => { cfg.bg.c1 = e.target.value; render(); };
  $('bgC2').oninput = (e) => { cfg.bg.c2 = e.target.value; render(); };
  $('bgAngle').oninput = (e) => { cfg.bg.angle = +e.target.value; render(); };
  $('bgImageV').oninput = (e) => { cfg.bg.image = e.target.value.trim(); render(); };
  $('bgDim').oninput = (e) => { cfg.bg.dim = +e.target.value; $('bgDimL').textContent = e.target.value + '%'; render(); };
  $('bgUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], (t) => { $('bgUpMsg').textContent = t; }); if (u) { setBgImage(u); loadLibrary(); } e.target.value = ''; };
  $('fontV').onchange = (e) => { cfg.font.family = e.target.value; render(); };
  $('radiusOn').onchange = (e) => { if (e.target.checked) { cfg.radius = +$('radiusV').value; $('radiusV').disabled = false; } else { cfg.radius = null; $('radiusV').disabled = true; } render(); };
  $('radiusV').oninput = (e) => { if ($('radiusOn').checked) { cfg.radius = +e.target.value; $('radiusL').textContent = e.target.value + 'px'; render(); } };
  $('nameV').oninput = (e) => { cfg.name = e.target.value; render(); };
  $('taglineV').oninput = (e) => { cfg.tagline = e.target.value; render(); };
  $('logoV').oninput = (e) => { cfg.logo = e.target.value.trim(); render(); };
  $('logoUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], (t) => { $('logoUpMsg').textContent = t; }); if (u) { cfg.logo = u; $('logoV').value = u; render(); loadLibrary(); } e.target.value = ''; };
  $('libUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], libMsg); if (u) loadLibrary(); e.target.value = ''; };
  $('publish').onclick = publish; $('reset').onclick = reset;
}

/* ---- guardar ---- */
function trimOrderHide(catalog, conf) {
  const def = catalog.map((c) => c[0]);
  const order = conf.order || [];
  const sameOrder = order.length === def.length && order.every((k, i) => k === def[i]);
  const hidden = conf.hidden || [];
  if (sameOrder && !hidden.length) return null;
  const out = {};
  if (!sameOrder) out.order = order;
  if (hidden.length) out.hidden = hidden;
  return out;
}
function buildOut() {
  const o = {};
  if (cfg.bg && cfg.bg.mode && cfg.bg.mode !== 'default') {
    const b = { mode: cfg.bg.mode };
    ['color', 'c1', 'c2', 'angle', 'image', 'dim'].forEach((k) => { if (cfg.bg[k] != null && cfg.bg[k] !== '') b[k] = cfg.bg[k]; });
    o.bg = b;
  }
  if (Object.keys(cfg.colors).length) o.colors = { ...cfg.colors };
  if (cfg.font.family && cfg.font.family !== 'system') o.font = { family: cfg.font.family };
  if (cfg.radius != null) o.radius = cfg.radius;
  if (cfg.name && cfg.name.trim()) o.name = cfg.name.trim();
  if (cfg.tagline && cfg.tagline.trim()) o.tagline = cfg.tagline.trim();
  if (cfg.logo && cfg.logo.trim()) o.logo = cfg.logo.trim();
  const t = trimOrderHide(TABS, cfg.tabs); if (t) o.tabs = t;
  const n = trimOrderHide(NAV, cfg.nav); if (n) o.nav = n;
  return o;
}
async function publish() {
  $('publish').disabled = true; msg('Publicando…');
  const { error } = await sb.from('site_config').upsert({ id: 1, config: buildOut(), updated_at: new Date().toISOString() });
  $('publish').disabled = false;
  if (error) { msg(/site_config|relation|exist/i.test(error.message || '') ? 'Falta crear la tabla site_config (ejecuta el SQL).' : 'Error: ' + (error.message || '')); return; }
  msg('¡Publicado! Los usuarios lo verán al recargar la app. ✅');
}
async function reset() {
  if (!confirm('¿Restablecer la apariencia por defecto para TODOS?')) return;
  cfg = defaults();
  try { await sb.from('site_config').upsert({ id: 1, config: {}, updated_at: new Date().toISOString() }); } catch (_) {}
  hydrateControls(); buildColorList(); buildLists(); render(); msg('Restablecido. ✅');
}

/* ---- arranque ---- */
async function boot() {
  let session;
  try { session = (await sb.auth.getSession()).data.session; } catch (_) {}
  if (!session) return gate('Inicia sesión en la app primero (con tu cuenta de administrador).', true);
  const { data: prof } = await sb.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle();
  if (!prof || !prof.is_admin) return gate('Acceso solo para administradores.', true);
  try { const { data } = await sb.from('site_config').select('config').eq('id', 1).maybeSingle(); if (data && data.config) cfg = mergeCfg(data.config); } catch (_) {}
  $('gate').style.display = 'none'; $('editor').style.display = 'grid';
  hydrateControls(); buildColorList(); buildLists(); wire(); render(); loadLibrary();
}
boot();
})();
