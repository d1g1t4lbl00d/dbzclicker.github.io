/* UnderBro · Editor de apariencia (solo admin). Publica en site_config y la app
   principal lo aplica para todos vía applySiteConfig(). */
(() => {
'use strict';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.UNDERBRO_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);

const NAV = [['feed','Stream'],['feed-trending','Trending'],['radio','Radio'],['beats','Beats'],['events','Eventos'],['posts','Fotos'],['people',"Bro's"],['all','All Tracks'],['favorites','Favorites'],['playlists','Playlists'],['ecosystems','Ecosystems'],['downloads','Downloads'],['messages','Chats'],['notifications','Notifications'],['settings','Settings']];
const TABS = [['following','Following'],['trending','Trending'],['new','New']];

let cfg = defaults();
function defaults() { return { bg: { mode: 'default' }, accent: null, name: '', tagline: '', tabs: { order: [], hidden: [] }, nav: { order: [], hidden: [] } }; }
function mergeCfg(loaded) {
  return {
    bg: Object.assign({ mode: 'default' }, loaded.bg || {}),
    accent: loaded.accent || null,
    name: loaded.name || '',
    tagline: loaded.tagline || '',
    tabs: { order: (loaded.tabs && loaded.tabs.order) || [], hidden: (loaded.tabs && loaded.tabs.hidden) || [] },
    nav: { order: (loaded.nav && loaded.nav.order) || [], hidden: (loaded.nav && loaded.nav.hidden) || [] },
  };
}
const msg = (t) => { $('msg').textContent = t || ''; };
function gate(text, link) { $('gate').innerHTML = `<div><div class="logo" style="font-size:34px;margin-bottom:10px">Under<span class="u">Bro</span></div><p>${text}</p>${link ? '<p><a href="/">Ir a la app</a></p>' : ''}</div>`; }

function bgValue(bg) {
  if (!bg) return '';
  if (bg.mode === 'color' && bg.color) return bg.color;
  if (bg.mode === 'gradient' && bg.c1 && bg.c2) return `linear-gradient(${bg.angle != null ? bg.angle : 135}deg, ${bg.c1}, ${bg.c2})`;
  if (bg.mode === 'image' && bg.image) return `#0a0d18 url("${String(bg.image).replace(/["\\]/g, '')}") center/cover`;
  return '';
}

/* ---- vista previa ---- */
function render() {
  const accent = cfg.accent || '#5f9bff';
  $('pv').style.setProperty('--blue', accent);
  $('pvName').textContent = (cfg.name && cfg.name.trim()) || 'UnderBro';
  $('pvTagline').textContent = (cfg.tagline && cfg.tagline.trim()) || 'upload. share. connect.';
  $('pvMain').style.background = bgValue(cfg.bg) || 'transparent';
  const tl = Object.fromEntries(TABS), nl = Object.fromEntries(NAV);
  const tabs = (cfg.tabs.order.length ? cfg.tabs.order : TABS.map((c) => c[0])).filter((k) => !(cfg.tabs.hidden || []).includes(k));
  $('pvTabs').innerHTML = tabs.map((k, i) => `<span class="${i === Math.min(1, tabs.length - 1) ? 'on' : ''}">${tl[k] || k}</span>`).join('');
  const navs = (cfg.nav.order.length ? cfg.nav.order : NAV.map((c) => c[0])).filter((k) => !(cfg.nav.hidden || []).includes(k)).slice(0, 8);
  $('pvNav').innerHTML = navs.map((k) => `<span>${nl[k] || k}</span>`).join('');
}

/* ---- listas reordenables (pestañas / menú) ---- */
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
    row.innerHTML = `<button data-up ${i === 0 ? 'disabled' : ''}>↑</button><button data-down ${i === order.length - 1 ? 'disabled' : ''}>↓</button><span class="nm">${labels[k]}</span><label class="vis"><input type="checkbox" ${hidden.has(k) ? '' : 'checked'}></label>`;
    row.querySelector('[data-up]').onclick = () => { if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; conf.order = order; renderOrderList(containerId, catalog, conf); render(); } };
    row.querySelector('[data-down]').onclick = () => { if (i < order.length - 1) { [order[i + 1], order[i]] = [order[i], order[i + 1]]; conf.order = order; renderOrderList(containerId, catalog, conf); render(); } };
    row.querySelector('input').onchange = (e) => { if (e.target.checked) hidden.delete(k); else hidden.add(k); conf.hidden = [...hidden]; row.classList.toggle('hidden-it', !e.target.checked); render(); };
    cont.appendChild(row);
  });
}
function buildLists() { renderOrderList('tabsList', TABS, cfg.tabs); renderOrderList('navList', NAV, cfg.nav); }

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
  $('accentOn').checked = !!cfg.accent; $('accentV').value = cfg.accent || '#5f9bff';
  $('nameV').value = cfg.name || ''; $('taglineV').value = cfg.tagline || '';
}
function wire() {
  document.querySelectorAll('#bgMode button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('#bgMode button').forEach((x) => x.classList.toggle('on', x === b));
    cfg.bg.mode = b.dataset.m; showBgPanels(); render();
  });
  $('bgColorV').oninput = (e) => { cfg.bg.color = e.target.value; render(); };
  $('bgC1').oninput = (e) => { cfg.bg.c1 = e.target.value; render(); };
  $('bgC2').oninput = (e) => { cfg.bg.c2 = e.target.value; render(); };
  $('bgAngle').oninput = (e) => { cfg.bg.angle = +e.target.value; render(); };
  $('bgImageV').oninput = (e) => { cfg.bg.image = e.target.value.trim(); render(); };
  $('accentV').oninput = (e) => { if ($('accentOn').checked) { cfg.accent = e.target.value; render(); } };
  $('accentOn').onchange = (e) => { cfg.accent = e.target.checked ? $('accentV').value : null; render(); };
  $('nameV').oninput = (e) => { cfg.name = e.target.value; render(); };
  $('taglineV').oninput = (e) => { cfg.tagline = e.target.value; render(); };
  $('publish').onclick = publish;
  $('reset').onclick = reset;
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
  if (cfg.bg && cfg.bg.mode && cfg.bg.mode !== 'default') o.bg = cfg.bg;
  if (cfg.accent) o.accent = cfg.accent;
  if (cfg.name && cfg.name.trim()) o.name = cfg.name.trim();
  if (cfg.tagline && cfg.tagline.trim()) o.tagline = cfg.tagline.trim();
  const t = trimOrderHide(TABS, cfg.tabs); if (t) o.tabs = t;
  const n = trimOrderHide(NAV, cfg.nav); if (n) o.nav = n;
  return o;
}
async function publish() {
  $('publish').disabled = true; msg('Publicando…');
  const { error } = await sb.from('site_config').upsert({ id: 1, config: buildOut(), updated_at: new Date().toISOString() });
  $('publish').disabled = false;
  if (error) { msg(/site_config|relation|exist/i.test(error.message || '') ? 'Falta crear la tabla site_config (ejecuta el SQL que te pasé).' : 'Error: ' + (error.message || '')); return; }
  msg('¡Publicado! Los usuarios lo verán al recargar la app. ✅');
}
async function reset() {
  if (!confirm('¿Restablecer la apariencia por defecto para TODOS?')) return;
  cfg = defaults();
  await sb.from('site_config').upsert({ id: 1, config: {}, updated_at: new Date().toISOString() }).catch(() => {});
  hydrateControls(); buildLists(); render(); msg('Restablecido. ✅');
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
  hydrateControls(); buildLists(); wire(); render();
}
boot();
})();
