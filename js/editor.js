/* UnderBro · Editor premium (solo admin).
   - Controles globales: fondo, colores, tipografía, formas, marca, orden de
     pestañas/menú, biblioteca de imágenes.
   - Visor real (iframe de la app) con inspector: selecciona cualquier elemento,
     arrástralo, edita texto/color/fondo/tamaño/relleno/opacidad, ocúltalo…
   - Deshacer/rehacer, exportar/importar tema. Publica en site_config. */
(() => {
'use strict';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.UNDERBRO_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const BUCKET = 'site-assets';
let mode = 'global', myId = null, myName = ''; // 'global' (admin) | 'personal' (usuario con permiso)
const isAdminMode = () => mode === 'global';
const libPrefix = () => (mode === 'personal' ? myId : '');
const fullName = (name) => { const p = libPrefix(); return p ? `${p}/${name}` : name; };

const NAV = [['feed','Stream'],['feed-trending','Trending'],['radio','Radio'],['beats','Beats'],['events','Eventos'],['posts','Fotos'],['people',"Bro's"],['all','All Tracks'],['favorites','Favorites'],['playlists','Playlists'],['ecosystems','Ecosystems'],['downloads','Downloads'],['messages','Chats'],['notifications','Notifications'],['settings','Settings']];
const TABS = [['following','Following'],['trending','Trending'],['new','New']];
const COLORS = [
  ['accent','Acento','#5f9bff'], ['accent2','Acento 2 (degradado)','#6e2df5'],
  ['ink','Texto principal','#e7ebf3'], ['ink2','Texto secundario','#cdd5e4'], ['inkSoft','Texto tenue','#8a94aa'],
  ['panel','Paneles','#121726'], ['panel2','Paneles secundarios','#1a2033'], ['line','Bordes','#232b40'], ['appbg','Fondo base','#0a0d18'],
];
const SITE_FONTS = { Poppins:'Poppins', Inter:'Inter', Montserrat:'Montserrat', Roboto:'Roboto', Nunito:'Nunito', Lato:'Lato', 'DM Sans':'DM Sans', 'Space Grotesk':'Space Grotesk', Oswald:'Oswald', 'Playfair Display':'Playfair Display' };
const PROPS = [
  { key:'color', label:'Color de texto', type:'color' },
  { key:'background-color', label:'Color de fondo', type:'color' },
  { key:'font-size', label:'Tamaño (px)', type:'num', unit:'px' },
  { key:'font-weight', label:'Grosor', type:'select', opts:['300','400','500','600','700','800','900'] },
  { key:'text-align', label:'Alineación', type:'select', opts:['left','center','right','justify'] },
  { key:'letter-spacing', label:'Espaciado letras', type:'num', unit:'px' },
  { key:'line-height', label:'Interlineado', type:'num' },
  { key:'width', label:'Ancho (px)', type:'num', unit:'px' },
  { key:'height', label:'Alto (px)', type:'num', unit:'px' },
  { key:'padding', label:'Relleno (px)', type:'num', unit:'px' },
  { key:'margin', label:'Margen (px)', type:'num', unit:'px' },
  { key:'border-radius', label:'Radio (px)', type:'num', unit:'px' },
  { key:'border-width', label:'Borde grosor', type:'num', unit:'px' },
  { key:'border-style', label:'Borde estilo', type:'select', opts:['none','solid','dashed','dotted','double'] },
  { key:'border-color', label:'Borde color', type:'color' },
  { key:'box-shadow', label:'Sombra', type:'select', opts:[{label:'—',value:''},{label:'Suave',value:'0 2px 8px rgba(0,0,0,.25)'},{label:'Media',value:'0 6px 20px rgba(0,0,0,.35)'},{label:'Fuerte',value:'0 14px 40px rgba(0,0,0,.5)'},{label:'Glow azul',value:'0 0 24px rgba(95,155,255,.7)'}] },
  { key:'object-fit', label:'Imagen: ajuste', type:'select', opts:['','cover','contain','fill','none','scale-down'] },
  { key:'object-position', label:'Imagen: posición', type:'select', opts:['','center','top','bottom','left','right'] },
  { key:'opacity', label:'Opacidad', type:'range', min:0, max:1, step:0.05 },
  { key:'z-index', label:'Capa (z-index)', type:'num' },
];
const THEME_PRESETS = [
  { name:'Aqua (def.)', cfg:{ bg:{mode:'default',dim:0}, colors:{ accent:'#4d8df5', accent2:'#6e2df5' }, font:{family:'system'}, radius:14 } },
  { name:'Underground', cfg:{ bg:{mode:'gradient',c1:'#0a0612',c2:'#180a2e',angle:160}, colors:{ accent:'#9b5cff', accent2:'#ff4db8', appbg:'#0a0612', panel:'#140a24', panel2:'#1d1036', line:'#2a1a44', ink:'#efe9ff', ink2:'#c9bce6', inkSoft:'#8a7bb0' }, font:{family:'Space Grotesk'}, radius:16 } },
  { name:'Neón rosa', cfg:{ bg:{mode:'color',color:'#0b0510'}, colors:{ accent:'#ff2db8', accent2:'#7a2dff', appbg:'#0b0510', panel:'#170a1d', panel2:'#1f1029', line:'#3a1a3f', ink:'#ffe9fb' }, font:{family:'Oswald'}, radius:10 } },
  { name:'Minimal claro', cfg:{ bg:{mode:'color',color:'#eef1f7'}, colors:{ accent:'#2a5bd7', accent2:'#2a5bd7', appbg:'#eef1f7', panel:'#ffffff', panel2:'#f5f7fb', line:'#e2e7f0', ink:'#1c2333', ink2:'#3a4259', inkSoft:'#7a8597' }, font:{family:'Inter'}, radius:12 } },
  { name:'Sunset', cfg:{ bg:{mode:'gradient',c1:'#2a1224',c2:'#3d1e10',angle:135}, colors:{ accent:'#ff7a3c', accent2:'#ff3c6e', appbg:'#1c0f18', panel:'#241420', panel2:'#2e1a28', line:'#3e2433', ink:'#ffeede' }, font:{family:'Montserrat'}, radius:18 } },
  { name:'Esmeralda', cfg:{ bg:{mode:'gradient',c1:'#05140f',c2:'#0a241c',angle:150}, colors:{ accent:'#16d6a4', accent2:'#2de0c0', appbg:'#05140f', panel:'#0c1f19', panel2:'#123026', line:'#1c3f33', ink:'#e6fff7' }, font:{family:'DM Sans'}, radius:14 } },
];
const EL_PRESETS = [
  { name:'🧊 Cristal', style:{ 'background-color':'rgba(255,255,255,.08)', 'border-width':'1px', 'border-style':'solid', 'border-color':'rgba(255,255,255,.18)', 'backdrop-filter':'blur(10px)', '-webkit-backdrop-filter':'blur(10px)', 'border-radius':'16px', 'box-shadow':'0 8px 30px rgba(0,0,0,.35)' } },
  { name:'💡 Neón', style:{ 'background-color':'transparent', 'border-width':'2px', 'border-style':'solid', 'border-color':'var(--blue)', 'box-shadow':'0 0 18px rgba(95,155,255,.75)', 'color':'#ffffff', 'border-radius':'12px' } },
  { name:'💊 Píldora', style:{ 'border-radius':'999px', 'padding':'10px 22px' } },
  { name:'🌫️ Sombra', style:{ 'box-shadow':'0 14px 40px rgba(0,0,0,.5)' } },
  { name:'⬜ Contorno', style:{ 'background-color':'transparent', 'border-width':'1px', 'border-style':'solid', 'border-color':'currentColor' } },
  { name:'🎟️ Tarjeta', style:{ 'background-color':'var(--panel-2)', 'border-radius':'16px', 'padding':'16px', 'box-shadow':'0 6px 20px rgba(0,0,0,.35)' } },
];

let cfg = defaults();
function defaults() { return { bg:{ mode:'default', dim:0 }, colors:{}, font:{ family:'system' }, radius:null, name:'', tagline:'', logo:'', tabs:{ order:[], hidden:[] }, nav:{ order:[], hidden:[] }, el:{}, add:[] }; }
function mergeCfg(l) {
  const colors = (l.colors && typeof l.colors === 'object') ? { ...l.colors } : {};
  if (l.accent && !colors.accent) colors.accent = l.accent;
  return {
    bg: Object.assign({ mode:'default', dim:0 }, l.bg || {}),
    colors,
    font: { family: (l.font && l.font.family) || 'system' },
    radius: (l.radius != null) ? +l.radius : null,
    name: l.name || '', tagline: l.tagline || '', logo: l.logo || '',
    tabs: { order:(l.tabs && l.tabs.order) || [], hidden:(l.tabs && l.tabs.hidden) || [] },
    nav: { order:(l.nav && l.nav.order) || [], hidden:(l.nav && l.nav.hidden) || [] },
    el: (l.el && typeof l.el === 'object') ? JSON.parse(JSON.stringify(l.el)) : {},
    add: Array.isArray(l.add) ? JSON.parse(JSON.stringify(l.add)) : [],
  };
}
const msg = (t) => { $('msg').textContent = t || ''; };
const libMsg = (t) => { $('libMsg').textContent = t || ''; };
function gate(text, link) { $('gate').innerHTML = `<div><div class="logo" style="font-size:34px;margin-bottom:10px">Under<span class="u">Bro</span></div><p>${text}</p>${link ? '<p><a href="/">Ir a la app</a></p>' : ''}</div>`; }

/* ===== helpers de tema ===== */
function loadFontInto(doc, name) {
  if (!name || name === 'system' || !SITE_FONTS[name]) return null;
  let link = doc.getElementById('site-font-link');
  const href = `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, '+')}:wght@400;500;600;700;800&display=swap`;
  if (!link) { link = doc.createElement('link'); link.id = 'site-font-link'; link.rel = 'stylesheet'; doc.head.appendChild(link); }
  if (link.href !== href) link.href = href;
  return `'${SITE_FONTS[name]}', system-ui, sans-serif`;
}
function bgValue(bg) {
  if (!bg) return '';
  if (bg.mode === 'color' && bg.color) return bg.color;
  if (bg.mode === 'gradient' && bg.c1 && bg.c2) return `linear-gradient(${bg.angle != null ? bg.angle : 135}deg, ${bg.c1}, ${bg.c2})`;
  if (bg.mode === 'image' && bg.image) { const d = Math.max(0, Math.min(85, +bg.dim || 0)) / 100; return `${d ? `linear-gradient(rgba(0,0,0,${d}),rgba(0,0,0,${d})),` : ''}#0a0d18 url("${String(bg.image).replace(/["\\]/g, '')}") center/cover fixed`; }
  return '';
}
function applyOrderHide(doc, containerSel, itemSel, key, conf) {
  if (!conf) return;
  const cont = doc.querySelector(containerSel); if (!cont) return;
  const items = [...cont.querySelectorAll(itemSel)], by = {};
  items.forEach((el) => { by[el.dataset[key]] = el; el.style.display = ''; });
  (conf.hidden || []).forEach((k) => { if (by[k]) by[k].style.display = 'none'; });
  (conf.order || []).forEach((k) => { const el = by[k]; if (el && el.parentNode) el.parentNode.appendChild(el); });
}
/* aplica TODA la config al documento del iframe (vista real) */
function applyGlobal(doc) {
  const root = doc.documentElement, body = doc.body;
  const set = (k, v) => { if (v) root.style.setProperty(k, v); else root.style.removeProperty(k); };
  const bv = bgValue(cfg.bg);
  body.style.background = bv || '';
  const app = doc.querySelector('.app'); if (app) app.style.background = bv ? 'transparent' : '';
  const c = cfg.colors || {}, acc = c.accent;
  set('--blue', acc); set('--blue-deep', acc); set('--blue-2', acc); set('--accent', acc);
  if (acc) { const g = `linear-gradient(120deg, ${acc} 0%, ${c.accent2 || acc} 100%)`; set('--accent-grad', g); set('--aqua-grad', g); set('--cover-grad', g); }
  else { set('--accent-grad', ''); set('--aqua-grad', ''); set('--cover-grad', ''); }
  set('--ink', c.ink); set('--ink-2', c.ink2); set('--ink-soft', c.inkSoft);
  set('--panel', c.panel); set('--panel-2', c.panel2);
  set('--line', c.line); set('--line-soft', c.line);
  set('--bg', c.appbg); set('--bg-2', c.appbg);
  const fam = loadFontInto(doc, cfg.font.family); set('--font', fam);
  if (cfg.radius != null) { const r = +cfg.radius; set('--r-sm', Math.round(r*0.7)+'px'); set('--r', r+'px'); set('--r-lg', Math.round(r*1.3)+'px'); set('--r-xl', Math.round(r*1.7)+'px'); }
  else { ['--r-sm','--r','--r-lg','--r-xl'].forEach((k) => root.style.removeProperty(k)); }
  doc.querySelectorAll('.logo').forEach((l) => { if (cfg.logo) l.innerHTML = `<img src="${cfg.logo}" alt="" style="height:1.15em;vertical-align:middle">`; else if (cfg.name) l.textContent = cfg.name; });
  applyOrderHide(doc, '#feedTabs', 'button[data-tab]', 'tab', cfg.tabs);
  applyOrderHide(doc, '#sidebar', '.nav-item[data-view]', 'view', cfg.nav);
}
const ANIMS = { fade:{kf:'ubFade',ease:'ease',count:'1',both:true,def:.6,label:'Aparecer'}, slide:{kf:'ubSlideUp',ease:'cubic-bezier(.22,.61,.36,1)',count:'1',both:true,def:.6,label:'Deslizar arriba'}, zoom:{kf:'ubZoom',ease:'ease',count:'1',both:true,def:.5,label:'Zoom'}, float:{kf:'ubFloat',ease:'ease-in-out',count:'infinite',def:3,label:'Flotar (bucle)'}, pulse:{kf:'ubPulse',ease:'ease-in-out',count:'infinite',def:2,label:'Latido (bucle)'}, spin:{kf:'ubSpin',ease:'linear',count:'infinite',def:6,label:'Girar (bucle)'}, shake:{kf:'ubShake',ease:'ease',count:'infinite',def:1,label:'Temblor (bucle)'} };
const ANIM_KF = '@keyframes ubFade{from{opacity:0}to{opacity:1}}@keyframes ubSlideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}@keyframes ubZoom{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}@keyframes ubFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes ubPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}@keyframes ubSpin{to{transform:rotate(360deg)}}@keyframes ubShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}';
function ensureAnimCss(doc) { if (doc.getElementById('ub-anim-kf')) return; const s = doc.createElement('style'); s.id = 'ub-anim-kf'; s.textContent = ANIM_KF; doc.head.appendChild(s); }
function composeDecls(o, important) {
  const bang = important ? ' !important' : '';
  const d = [];
  if (o.hide) d.push('display:none' + bang);
  const tr = [];
  if (o.move && (o.move.x || o.move.y)) tr.push(`translate(${+o.move.x||0}px,${+o.move.y||0}px)`);
  if (o.rot) tr.push(`rotate(${+o.rot}deg)`);
  if (o.scale != null && +o.scale !== 1) tr.push(`scale(${+o.scale})`);
  if (tr.length) d.push(`transform:${tr.join(' ')}${bang}`);
  const fl = [];
  if (o.blur) fl.push(`blur(${+o.blur}px)`);
  if (o.bright != null && +o.bright !== 100) fl.push(`brightness(${+o.bright}%)`);
  if (fl.length) d.push(`filter:${fl.join(' ')}${bang}`);
  if (o.anim && o.anim.name && ANIMS[o.anim.name]) { const a = ANIMS[o.anim.name]; const dur = +o.anim.dur || a.def; d.push(`animation:${a.kf} ${dur}s ${a.ease} ${a.count}${a.both ? ' both' : ''}${bang}`); }
  if (o.style) for (const p in o.style) { if (o.style[p] !== '' && o.style[p] != null) d.push(`${p}:${o.style[p]}${bang}`); }
  return d;
}
function applyEl(doc) {
  let css = ''; const dyn = [], el = cfg.el || {};
  for (const sel in el) { const o = el[sel]; if (!o) continue;
    const d = composeDecls(o, true);
    if (d.length) css += `${sel}{${d.join(';')}}\n`;
    if (o.text != null || o.img != null) dyn.push([sel, o]);
  }
  let tag = doc.getElementById('ub-el-css'); if (!tag) { tag = doc.createElement('style'); tag.id = 'ub-el-css'; doc.head.appendChild(tag); }
  tag.textContent = css;
  dyn.forEach(([sel, o]) => { try { doc.querySelectorAll(sel).forEach((n) => {
    if (o.text != null && n.textContent !== o.text) n.textContent = o.text;
    if (o.img != null && n.tagName === 'IMG' && n.getAttribute('src') !== o.img) n.setAttribute('src', o.img);
  }); } catch (_) {} });
}
function edMakeAdded(doc, it) {
  if (!it || !it.id || it.hide) return null;
  const tag = it.type === 'button' ? 'a' : (it.type === 'image' ? 'img' : 'div');
  const e = doc.createElement(tag); const s = e.style;
  e.setAttribute('data-ubid', it.id);
  s.position = 'absolute'; s.left = (+it.x || 0) + 'px'; s.top = (+it.y || 0) + 'px'; s.pointerEvents = 'auto';
  if (it.type === 'image') { e.src = it.src || ''; e.alt = ''; s.display = 'block'; s.objectFit = 'cover'; if (!(it.style && it.style.width)) s.width = '200px'; }
  else if (it.type === 'button') { e.textContent = it.text || 'Botón'; if (it.href) e.href = it.href; e.addEventListener('click', (ev) => ev.preventDefault()); s.display = 'inline-block'; s.textDecoration = 'none'; s.padding = '10px 18px'; s.borderRadius = '30px'; s.background = 'var(--blue)'; s.color = '#fff'; s.fontWeight = '700'; s.fontSize = '14px'; }
  else if (it.type === 'text') { e.textContent = it.text || 'Texto'; s.fontSize = '20px'; s.fontWeight = '700'; s.color = 'var(--ink)'; }
  else { if (!(it.style && it.style.width)) s.width = '160px'; if (!(it.style && it.style.height)) s.height = '90px'; s.background = 'rgba(95,155,255,.22)'; s.borderRadius = '12px'; }
  composeDecls(it, false).forEach((decl) => { const i = decl.indexOf(':'); try { s.setProperty(decl.slice(0, i), decl.slice(i + 1)); } catch (_) {} });
  return e;
}
function applyAdded(doc) {
  let layer = doc.getElementById('ub-custom');
  const list = cfg.add || [];
  if (!list.length) { if (layer) layer.remove(); return; }
  if (!layer) { layer = doc.createElement('div'); layer.id = 'ub-custom'; doc.body.appendChild(layer); }
  layer.style.cssText = 'position:fixed;inset:0;z-index:40;pointer-events:none';
  layer.innerHTML = '';
  list.forEach((it) => { const e = edMakeAdded(doc, it); if (e) layer.appendChild(e); });
}
function applyAll() { const d = frameDoc(); if (!d || !d.body) return; try { applyEl(d); applyAdded(d); if (selMode === 'add' && cfg.add[addIndex]) selectedEl = d.querySelector(`[data-ubid="${cfg.add[addIndex].id}"]`); repositionSel(); } catch (_) {} }
const frameDoc = () => { try { return $('appFrame').contentDocument; } catch (_) { return null; } };
const frameWin = () => { try { return $('appFrame').contentWindow; } catch (_) { return null; } };
function render() { const doc = frameDoc(); if (!doc || !doc.body) return; try { ensureAnimCss(doc); applyGlobal(doc); applyEl(doc); applyAdded(doc); repositionSel(); } catch (_) {} }

/* ===== historial (deshacer / rehacer) ===== */
let history = [], future = [], _snapT = 0, dirty = false;
function setDirty(v) { dirty = v; const b = $('publish'); if (b) b.textContent = (mode === 'personal' ? 'Guardar mi web' : 'Publicar cambios') + (v ? ' •' : ''); }
function snap() { setDirty(true); scheduleSave(); const now = Date.now(); if (now - _snapT < 350 && history.length) { _snapT = now; future = []; updateUndo(); return; } history.push(JSON.stringify(cfg)); if (history.length > 80) history.shift(); future = []; _snapT = now; updateUndo(); }
function updateUndo() { $('tUndo').disabled = !history.length; $('tRedo').disabled = !future.length; $('tUndo').style.opacity = history.length ? 1 : .4; $('tRedo').style.opacity = future.length ? 1 : .4; }
function restoreFrom(stack, other) { if (!stack.length) return; other.push(JSON.stringify(cfg)); cfg = JSON.parse(stack.pop()); hydrateControls(); buildColorList(); buildLists(); buildLayers(); render(); if (selector && cfg.el) fillPanel(); updateUndo(); scheduleSave(); }

/* ===== listas reordenables ===== */
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
    row.innerHTML = `<button data-up ${i===0?'disabled':''}>↑</button><button data-down ${i===order.length-1?'disabled':''}>↓</button><span class="nm">${labels[k]}</span><label><input type="checkbox" ${hidden.has(k)?'':'checked'}></label>`;
    row.querySelector('[data-up]').onclick = () => { if (i>0) { snap(); [order[i-1],order[i]]=[order[i],order[i-1]]; conf.order=order; renderOrderList(containerId,catalog,conf); render(); } };
    row.querySelector('[data-down]').onclick = () => { if (i<order.length-1) { snap(); [order[i+1],order[i]]=[order[i],order[i+1]]; conf.order=order; renderOrderList(containerId,catalog,conf); render(); } };
    row.querySelector('input').onchange = (e) => { snap(); if (e.target.checked) hidden.delete(k); else hidden.add(k); conf.hidden=[...hidden]; row.classList.toggle('hidden-it', !e.target.checked); render(); };
    cont.appendChild(row);
  });
}
function buildLists() { renderOrderList('tabsList', TABS, cfg.tabs); renderOrderList('navList', NAV, cfg.nav); }
function applyThemePreset(p) {
  snap();
  const c = JSON.parse(JSON.stringify(p.cfg));
  cfg.bg = Object.assign({ mode:'default', dim:0 }, c.bg || {});
  cfg.colors = Object.assign({}, c.colors || {});
  if (c.font) cfg.font = { family: c.font.family || 'system' };
  if (c.radius != null) cfg.radius = c.radius;
  hydrateControls(); buildColorList(); render(); msg('Preset aplicado: ' + p.name + ' (Publica para guardar).');
}
function buildThemePresets() {
  const c = $('themePresets'); if (!c) return; c.innerHTML = '';
  THEME_PRESETS.forEach((p) => { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = p.name; b.style.flex = '1 1 46%'; b.onclick = () => applyThemePreset(p); c.appendChild(b); });
}
function applyElPreset(p) { const o = curObj(); if (!o) { msg('Selecciona un elemento primero (🎯 Inspeccionar).'); return; } snap(); o.style = o.style || {}; Object.assign(o.style, p.style); applyAll(); fillPanel(); }
function buildElPresets() {
  const c = $('elPresets'); if (!c) return; c.innerHTML = '';
  EL_PRESETS.forEach((p) => { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = p.name; b.style.flex = '1 1 46%'; b.onclick = () => applyElPreset(p); c.appendChild(b); });
}
function buildColorList() {
  const cont = $('colorList'); cont.innerHTML = '';
  COLORS.forEach(([key, label, def]) => {
    const on = cfg.colors[key] != null;
    const row = document.createElement('div'); row.className = 'clr-row';
    row.innerHTML = `<input type="checkbox" ${on?'checked':''}><input type="color" value="${cfg.colors[key]||def}" ${on?'':'disabled'}><span class="nm">${label}</span>`;
    const [chk, clr] = row.querySelectorAll('input');
    chk.onchange = () => { snap(); if (chk.checked) { cfg.colors[key]=clr.value; clr.disabled=false; } else { delete cfg.colors[key]; clr.disabled=true; } render(); };
    clr.oninput = () => { if (chk.checked) { cfg.colors[key]=clr.value; render(); } };
    clr.onchange = () => snap();
    cont.appendChild(row);
  });
}

/* ===== imágenes ===== */
async function uploadImage(file, setMsg) {
  if (!file) return null;
  setMsg && setMsg('Subiendo…');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const folder = (mode === 'personal') ? `${myId}/` : '';
  const path = `${folder}${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: '31536000', upsert: false });
  if (error) { setMsg && setMsg(/bucket|not found|exist|policy|row-level/i.test(error.message||'') ? 'Falta el bucket site-assets (ejecuta el SQL).' : 'Error: ' + error.message); return null; }
  setMsg && setMsg('Subida ✓');
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
function setBgImage(url) { snap(); cfg.bg.mode='image'; cfg.bg.image=url; document.querySelectorAll('#bgMode button').forEach((x)=>x.classList.toggle('on',x.dataset.m==='image')); showBgPanels(); $('bgImageV').value=url; render(); }
async function loadLibrary() {
  const grid = $('libGrid');
  const { data, error } = await sb.storage.from(BUCKET).list(libPrefix(), { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<p class="hint">${/bucket|not found/i.test(error.message||'') ? 'Crea el bucket site-assets (ejecuta el SQL).' : error.message}</p>`; return; }
  const imgs = (data || []).filter((o) => o.id && o.name && !o.name.startsWith('.'));
  if (!imgs.length) { grid.innerHTML = '<p class="hint">Aún no has subido imágenes.</p>'; return; }
  grid.innerHTML = '';
  imgs.forEach((o) => {
    const url = sb.storage.from(BUCKET).getPublicUrl(fullName(o.name)).data.publicUrl;
    const el = document.createElement('div'); el.className = 'lib-it';
    el.innerHTML = `<img src="${url}" loading="lazy"><div class="ov"><button data-a="bg">Fondo</button><button data-a="logo">Logo</button><button data-a="copy">Copiar URL</button><button class="del" data-a="del">Borrar</button></div>`;
    el.querySelector('[data-a="bg"]').onclick = () => { setBgImage(url); libMsg('Fondo aplicado (Publica para guardar).'); };
    el.querySelector('[data-a="logo"]').onclick = () => { snap(); cfg.logo=url; $('logoV').value=url; render(); libMsg('Logo aplicado (Publica para guardar).'); };
    el.querySelector('[data-a="copy"]').onclick = () => { (navigator.clipboard && navigator.clipboard.writeText(url)); libMsg('URL copiada ✓'); };
    el.querySelector('[data-a="del"]').onclick = async () => { if (!confirm('¿Borrar esta imagen del almacenamiento?')) return; await sb.storage.from(BUCKET).remove([fullName(o.name)]); loadLibrary(); };
    grid.appendChild(el);
  });
}

/* ===== selector de imágenes (picker) ===== */
let pickerResolve = null, imgTarget = 'bg';
function openPicker() { return new Promise((resolve) => { pickerResolve = resolve; $('picker').hidden = false; loadPickGrid(); }); }
function closePicker(v) { $('picker').hidden = true; const r = pickerResolve; pickerResolve = null; if (r) r(v || null); }
async function loadPickGrid() {
  const grid = $('pickGrid'); grid.innerHTML = '<p class="hint">Cargando…</p>';
  const { data, error } = await sb.storage.from(BUCKET).list(libPrefix(), { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<p class="hint">${/bucket|not found/i.test(error.message||'') ? 'Crea el bucket site-assets (ejecuta el SQL).' : 'Error al listar.'}</p>`; return; }
  const imgs = (data || []).filter((o) => o.id && o.name && !o.name.startsWith('.'));
  if (!imgs.length) { grid.innerHTML = '<p class="hint">Sube una imagen primero (botón de arriba).</p>'; return; }
  grid.innerHTML = '';
  imgs.forEach((o) => {
    const url = sb.storage.from(BUCKET).getPublicUrl(fullName(o.name)).data.publicUrl;
    const d = document.createElement('div'); d.className = 'lib-it'; d.style.cursor = 'pointer';
    d.innerHTML = `<img src="${url}" loading="lazy">`;
    d.onclick = () => closePicker(url);
    grid.appendChild(d);
  });
}
function setElBg(url) {
  const o = curObj(); if (!o) return; snap(); o.style = o.style || {};
  o.style['background-image'] = `url("${url}")`;
  if (!o.style['background-size']) o.style['background-size'] = 'cover';
  o.style['background-position'] = 'center'; o.style['background-repeat'] = 'no-repeat';
  applyAll(); fillPanel();
}
function setElImg(url) { const o = curObj(); if (!o) return; snap(); if (selMode === 'add' && o.type === 'image') o.src = url; else o.img = url; applyAll(); libMsg('Imagen aplicada (Publica para guardar).'); }

/* ===== controles globales ===== */
function showBgPanels() { $('bgColor').style.display = cfg.bg.mode==='color'?'':'none'; $('bgGrad').style.display = cfg.bg.mode==='gradient'?'':'none'; $('bgImage').style.display = cfg.bg.mode==='image'?'':'none'; }
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
  document.querySelectorAll('#bgMode button').forEach((b) => b.onclick = () => { snap(); document.querySelectorAll('#bgMode button').forEach((x)=>x.classList.toggle('on',x===b)); cfg.bg.mode=b.dataset.m; showBgPanels(); render(); });
  $('bgColorV').oninput = (e) => { cfg.bg.color=e.target.value; render(); }; $('bgColorV').onchange = snap;
  $('bgC1').oninput = (e) => { cfg.bg.c1=e.target.value; render(); }; $('bgC1').onchange = snap;
  $('bgC2').oninput = (e) => { cfg.bg.c2=e.target.value; render(); }; $('bgC2').onchange = snap;
  $('bgAngle').oninput = (e) => { cfg.bg.angle=+e.target.value; render(); }; $('bgAngle').onchange = snap;
  $('bgImageV').oninput = (e) => { snap(); cfg.bg.image=e.target.value.trim(); render(); };
  $('bgDim').oninput = (e) => { cfg.bg.dim=+e.target.value; $('bgDimL').textContent=e.target.value+'%'; render(); }; $('bgDim').onchange = snap;
  $('bgUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], (t)=>{$('bgUpMsg').textContent=t;}); if (u) { setBgImage(u); loadLibrary(); } e.target.value=''; };
  $('fontV').onchange = (e) => { snap(); cfg.font.family=e.target.value; render(); };
  $('radiusOn').onchange = (e) => { snap(); if (e.target.checked) { cfg.radius=+$('radiusV').value; $('radiusV').disabled=false; } else { cfg.radius=null; $('radiusV').disabled=true; } render(); };
  $('radiusV').oninput = (e) => { if ($('radiusOn').checked) { cfg.radius=+e.target.value; $('radiusL').textContent=e.target.value+'px'; render(); } }; $('radiusV').onchange = snap;
  $('nameV').oninput = (e) => { cfg.name=e.target.value; render(); }; $('nameV').onfocus = snap;
  $('taglineV').oninput = (e) => { cfg.tagline=e.target.value; render(); }; $('taglineV').onfocus = snap;
  $('logoV').oninput = (e) => { cfg.logo=e.target.value.trim(); render(); }; $('logoV').onfocus = snap;
  $('logoUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], (t)=>{$('logoUpMsg').textContent=t;}); if (u) { snap(); cfg.logo=u; $('logoV').value=u; render(); loadLibrary(); } e.target.value=''; };
  $('libUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], libMsg); if (u) loadLibrary(); e.target.value=''; };
  $('publish').onclick = publish; $('reset').onclick = resetAll;
  // toolbar visor
  $('tInspect').onclick = toggleInspect;
  $('tUndo').onclick = () => restoreFrom(history, future);
  $('tRedo').onclick = () => restoreFrom(future, history);
  $('tReload').onclick = () => { $('appFrame').src = $('appFrame').src; };
  $('tViewport').onchange = (e) => { $('pvStage').classList.toggle('mobile', e.target.value === 'mobile'); };
  $('tExport').onclick = exportTheme;
  $('tImport').onchange = importTheme;
  $('tplExport').onclick = exportComponents;
  $('tplImport').onchange = importComponents;
  $('projSel').onchange = (e) => switchProject(e.target.value);
  $('projNew').onclick = projNew; $('projRename').onclick = projRename; $('projDup').onclick = projDup; $('projDel').onclick = projDel;
  $('marketBtn').onclick = openMarket; $('marketClose').onclick = closeMarket; $('marketShare').onclick = shareTheme;
  $('market').onclick = (e) => { if (e.target === $('market')) closeMarket(); };
  // panel propiedades
  buildPropRows();
  $('pClose').onclick = closePanel;
  $('pScope').onchange = (e) => { scopeAll = !!(e.target.checked && genericSel); selector = scopeAll ? genericSel : specificSel; fillPanel(); };
  $('pText').oninput = () => { const o = curObj(); if (!o) return; o.text = $('pText').value; applyAll(); }; $('pText').onfocus = snap;
  $('pHref').oninput = () => { const o = curObj(); if (o && selMode === 'add') { o.href = $('pHref').value.trim(); applyAll(); } }; $('pHref').onfocus = snap;
  const moveUpd = () => { const o = curObj(); if (!o) return; if (selMode === 'add') { o.x = +$('pMoveX').value || 0; o.y = +$('pMoveY').value || 0; } else { o.move = { x:+$('pMoveX').value||0, y:+$('pMoveY').value||0 }; } applyAll(); };
  $('pMoveX').oninput = moveUpd; $('pMoveY').oninput = moveUpd; $('pMoveX').onfocus = $('pMoveY').onfocus = snap;
  $('pHide').onclick = () => { const o = curObj(); if (!o) return; snap(); o.hide = !o.hide; applyAll(); $('pHide').textContent = o.hide ? 'Mostrar' : 'Ocultar'; };
  $('pResetEl').onclick = () => { snap(); if (selMode === 'add') { cfg.add.splice(addIndex, 1); closePanel(); } else if (selector) { delete cfg.el[selector]; fillPanel(); } applyAll(); };
  $('pDup').onclick = () => { if (selMode !== 'add' || !cfg.add[addIndex]) return; snap(); const c = JSON.parse(JSON.stringify(cfg.add[addIndex])); c.id = 'ub_' + Math.random().toString(36).slice(2, 8); c.x = (+c.x||0) + 20; c.y = (+c.y||0) + 20; cfg.add.push(c); applyAll(); selectAdd(cfg.add.length - 1); };
  // efectos (rotación/escala/desenfoque/brillo)
  const fx = (key, el, def) => { $(el).oninput = () => { const o = curObj(); if (!o) return; o[key] = +$(el).value; applyAll(); }; $(el).onchange = snap; };
  fx('rot', 'pRot'); fx('scale', 'pScale'); fx('blur', 'pBlur'); fx('bright', 'pBright');
  $('clrRot').onclick = () => { snap(); const o = curObj(); if (o) delete o.rot; $('pRot').value = 0; applyAll(); };
  $('clrScale').onclick = () => { snap(); const o = curObj(); if (o) delete o.scale; $('pScale').value = 1; applyAll(); };
  $('clrBlur').onclick = () => { snap(); const o = curObj(); if (o) delete o.blur; $('pBlur').value = 0; applyAll(); };
  $('clrBright').onclick = () => { snap(); const o = curObj(); if (o) delete o.bright; $('pBright').value = 100; applyAll(); };
  // crear elementos
  $('addText').onclick = () => addElement('text');
  $('addImg').onclick = () => addElement('image');
  $('addBox').onclick = () => addElement('box');
  $('addBtn').onclick = () => addElement('button');
  $('addCircle').onclick = () => addElement('circle');
  $('addLine').onclick = () => addElement('line');
  // presets de elemento y animaciones
  buildElPresets(); buildThemePresets();
  $('pAnim').innerHTML = '<option value="">Sin animación</option>' + Object.keys(ANIMS).map((k) => `<option value="${k}">${ANIMS[k].label}</option>`).join('');
  $('pAnim').onchange = () => { const o = curObj(); if (!o) return; snap(); const v = $('pAnim').value; if (!v) delete o.anim; else o.anim = { name: v, dur: +$('pAnimDur').value || ANIMS[v].def }; applyAll(); };
  $('pAnimDur').oninput = () => { const o = curObj(); if (!o || !o.anim) return; o.anim.dur = +$('pAnimDur').value; $('pAnimDurL').textContent = $('pAnimDur').value + 's'; applyAll(); }; $('pAnimDur').onchange = snap;
  // imágenes por elemento
  $('pBgUp').onclick = () => { imgTarget = 'bg'; $('pImgFile').click(); };
  $('pImgUp').onclick = () => { imgTarget = 'img'; $('pImgFile').click(); };
  $('pBgLib').onclick = async () => { const u = await openPicker(); if (u) setElBg(u); };
  $('pImgLib').onclick = async () => { const u = await openPicker(); if (u) setElImg(u); };
  $('pBgClear').onclick = () => { const o = curObj(); if (!o || !o.style) return; snap(); ['background-image','background-size','background-position','background-repeat'].forEach((k) => delete o.style[k]); applyAll(); fillPanel(); };
  $('pBgSize').onchange = () => { const o = curObj(); if (!o) return; snap(); o.style = o.style || {}; if ($('pBgSize').value) o.style['background-size'] = $('pBgSize').value; else delete o.style['background-size']; applyAll(); };
  $('pImgFile').onchange = async (e) => { const u = await uploadImage(e.target.files[0], libMsg); if (u) { (imgTarget === 'img') ? setElImg(u) : setElBg(u); loadLibrary(); } e.target.value = ''; };
  $('pickClose').onclick = () => closePicker(null);
  $('picker').onclick = (e) => { if (e.target === $('picker')) closePicker(null); };
  $('pickUpload').onchange = async (e) => { const u = await uploadImage(e.target.files[0], libMsg); if (u) { loadLibrary(); closePicker(u); } e.target.value = ''; };
  // teclas: atajos globales + nudge del elemento seleccionado
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { if (typing) return; e.preventDefault(); if (e.shiftKey) restoreFrom(future, history); else restoreFrom(history, future); return; }
    if (mod && (e.key === 'y' || e.key === 'Y')) { if (typing) return; e.preventDefault(); restoreFrom(future, history); return; }
    if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); publish(); return; }
    if (mod && (e.key === 'd' || e.key === 'D')) { if (selMode === 'add' && cfg.add[addIndex]) { e.preventDefault(); $('pDup').click(); } return; }
    if (e.key === 'Escape') { if (!$('market').hidden) return closeMarket(); if (!$('picker').hidden) return closePicker(null); if (!$('propPanel').hidden) return closePanel(); if (inspectOn) toggleInspect(); return; }
    if (typing || !selectedEl) return;
    const o = curObj();
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); snap(); if (selMode === 'add') { cfg.add.splice(addIndex, 1); closePanel(); } else if (o) { o.hide = true; fillPanel(); } applyAll(); return; }
    const arrows = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
    if (arrows[e.key] && o) { e.preventDefault(); const s = e.shiftKey ? 10 : 1, a = arrows[e.key];
      if (selMode === 'add') { o.x = (+o.x || 0) + a[0] * s; o.y = (+o.y || 0) + a[1] * s; } else { const m = o.move || { x:0, y:0 }; o.move = { x:m.x + a[0]*s, y:m.y + a[1]*s }; }
      applyAll(); syncMoveInputs(); }
  });
  $('tUndo').title = 'Deshacer (Ctrl/Cmd+Z)'; $('tRedo').title = 'Rehacer (Ctrl/Cmd+Shift+Z)';
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

/* ===== panel de propiedades ===== */
function buildPropRows() {
  const c = $('propStyles'); c.innerHTML = '';
  PROPS.forEach((p) => {
    const row = document.createElement('div'); row.className = 'prop-row';
    let ctrl;
    if (p.type === 'color') ctrl = `<input type="color" id="prop_${p.key}">`;
    else if (p.type === 'num') ctrl = `<input type="number" id="prop_${p.key}">`;
    else if (p.type === 'range') ctrl = `<input type="range" id="prop_${p.key}" min="${p.min}" max="${p.max}" step="${p.step}">`;
    else if (p.type === 'select') ctrl = `<select id="prop_${p.key}">${(typeof p.opts[0] === 'object' ? '' : '<option value="">—</option>')}${p.opts.map((o) => { const v = (typeof o === 'object') ? o.value : o; const l = (typeof o === 'object') ? o.label : o; return `<option value="${v}">${l}</option>`; }).join('')}</select>`;
    row.innerHTML = `<label>${p.label}</label>${ctrl}<button class="clr" id="clr_${p.key}" title="Quitar">↺</button>`;
    c.appendChild(row);
    const input = row.querySelector(`#prop_${p.key}`);
    const commit = (v) => { const o = curObj(); if (!o) return; o.style = o.style || {}; if (v === '' || v == null) delete o.style[p.key]; else o.style[p.key] = v + (p.unit || ''); applyAll(); };
    input.oninput = () => commit(input.value); input.onchange = snap; input.onfocus = snap;
    row.querySelector(`#clr_${p.key}`).onclick = () => { snap(); input.value = p.type === 'color' ? '#000000' : ''; commit(''); };
  });
}
function fillPanel() {
  const o = (selMode === 'add') ? (cfg.add[addIndex] || {}) : ((cfg.el && cfg.el[selector]) || {});
  const st = o.style || {};
  $('pText').value = o.text != null ? o.text : '';
  $('pText').placeholder = selectedEl ? (selectedEl.textContent || '').slice(0, 60) : '(texto)';
  $('pHref').value = o.href || '';
  const cs = (selectedEl && selMode === 'el') ? frameWin().getComputedStyle(selectedEl) : null;
  PROPS.forEach((p) => {
    const input = $('prop_' + p.key); if (!input) return;
    const raw = st[p.key];
    if (raw != null) { input.value = (p.unit ? parseFloat(raw) : raw); }
    else if (cs) {
      if (p.type === 'color') { try { input.value = rgb2hex(cs[p.key === 'background-color' ? 'backgroundColor' : (p.key === 'border-color' ? 'borderTopColor' : 'color')]); } catch (_) {} }
      else if (p.type === 'num') input.value = parseFloat(cs.getPropertyValue(p.key)) || 0;
      else if (p.type === 'range') input.value = parseFloat(cs.opacity) || 1;
      else input.value = '';
    } else if (p.type === 'range') input.value = (p.key === 'opacity' ? 1 : 0);
    else if (p.type !== 'color') input.value = '';
  });
  $('pRot').value = o.rot || 0; $('pScale').value = (o.scale != null ? o.scale : 1); $('pBlur').value = o.blur || 0; $('pBright').value = (o.bright != null ? o.bright : 100);
  $('pAnim').value = (o.anim && o.anim.name) || ''; $('pAnimDur').value = (o.anim && o.anim.dur) || 1; $('pAnimDurL').textContent = ((o.anim && o.anim.dur) || 1) + 's';
  $('pBgSize').value = st['background-size'] || '';
  $('pImgRow').style.display = ((selectedEl && selectedEl.tagName === 'IMG') || (selMode === 'add' && o.type === 'image')) ? '' : 'none';
  if (selMode === 'add') { $('pMoveX').value = o.x || 0; $('pMoveY').value = o.y || 0; }
  else { const m = o.move || { x:0, y:0 }; $('pMoveX').value = m.x || 0; $('pMoveY').value = m.y || 0; }
  $('pHide').textContent = o.hide ? 'Mostrar' : 'Ocultar';
  positionGrip();
}
function syncMoveInputs() {
  if (selMode === 'add' && cfg.add[addIndex]) { $('pMoveX').value = cfg.add[addIndex].x || 0; $('pMoveY').value = cfg.add[addIndex].y || 0; return; }
  const m = (cfg.el[selector] && cfg.el[selector].move) || { x:0, y:0 }; $('pMoveX').value = m.x || 0; $('pMoveY').value = m.y || 0;
}
function rgb2hex(rgb) {
  const m = (rgb || '').match(/\d+/g); if (!m) return '#000000';
  return '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
}
function ensureEl() { if (!cfg.el) cfg.el = {}; if (!cfg.el[selector]) cfg.el[selector] = {}; }
function closePanel() { $('propPanel').hidden = true; selector = null; selectedEl = null; selMode = 'el'; addIndex = -1; if (selBox) selBox.style.display = 'none'; if (handles) for (const d in handles) handles[d].style.display = 'none'; if ($('layersList')) buildLayers(); positionGrip(); }

/* ===== inspector del visor ===== */
let inspectOn = false, selectedEl = null, selector = null, specificSel = null, genericSel = null, scopeAll = false, hlBox = null, selBox = null, selMode = 'el', addIndex = -1, handles = null;
function curObj() { if (selMode === 'add') return cfg.add[addIndex]; if (!selector) return null; ensureEl(); return cfg.el[selector]; }
function cssPath(el, win) {
  if (!el || el.nodeType !== 1) return '';
  const esc = (win.CSS && win.CSS.escape) ? win.CSS.escape.bind(win.CSS) : ((s) => s);
  if (el.id) return '#' + esc(el.id);
  const parts = []; let node = el;
  while (node && node.nodeType === 1 && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
    if (node.id) { parts.unshift('#' + esc(node.id)); break; }
    let part = node.tagName.toLowerCase();
    const parent = node.parentNode;
    if (parent) { const sibs = [...parent.children].filter((c) => c.tagName === node.tagName); if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`; }
    parts.unshift(part); node = node.parentNode;
  }
  return parts.join('>');
}
// selector "de grupo": clases comunes para afectar a todas las iguales (p. ej. todas las tarjetas)
function genericPath(el, win) {
  const esc = (win.CSS && win.CSS.escape) ? win.CSS.escape.bind(win.CSS) : ((s) => s);
  const cls = ((el.getAttribute && el.getAttribute('class')) || '').trim().split(/\s+/).filter(Boolean);
  if (cls.length) return cls.map((c) => '.' + esc(c)).join('');
  return null;
}
function boxOver(box, el) { if (!box) return; if (!el) { box.style.display = 'none'; return; } const r = el.getBoundingClientRect(); box.style.display = 'block'; box.style.left = r.left + 'px'; box.style.top = r.top + 'px'; box.style.width = r.width + 'px'; box.style.height = r.height + 'px'; }
function repositionSel() { if (selBox && selectedEl) { boxOver(selBox, selectedEl); placeHandles(selectedEl.getBoundingClientRect()); } else if (handles) { for (const d in handles) handles[d].style.display = 'none'; } }
function toggleInspect() { inspectOn = !inspectOn; $('tInspect').classList.toggle('on', inspectOn); $('pvStage').classList.toggle('inspect', inspectOn); const doc = frameDoc(); if (doc) doc.documentElement.classList.toggle('__ubinspect', inspectOn); if (!inspectOn && hlBox) hlBox.style.display = 'none'; repositionSel(); }
function selectEl(el) {
  selMode = 'el'; addIndex = -1; selectedEl = el;
  specificSel = cssPath(el, frameWin());
  genericSel = genericPath(el, frameWin());
  scopeAll = false; selector = specificSel;
  const sc = $('pScope'); sc.checked = false; sc.disabled = !genericSel;
  $('pScopeSel').textContent = genericSel ? `(${genericSel})` : '(sin clase común)';
  $('pScopeRow').style.display = ''; $('pScopeRow').style.opacity = genericSel ? 1 : .5;
  $('pHrefRow').style.display = 'none'; $('pDup').style.display = 'none';
  boxOver(selBox, el); if (hlBox) hlBox.style.display = 'none';
  $('propPanel').hidden = false; $('pTag').textContent = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
  buildBread(el); fillPanel(); buildLayers();
}
function selectAdd(idx) {
  if (idx < 0 || !cfg.add[idx]) return;
  selMode = 'add'; addIndex = idx; selector = null; scopeAll = false;
  selectedEl = frameDoc().querySelector(`[data-ubid="${cfg.add[idx].id}"]`);
  $('pScopeRow').style.display = 'none';
  $('pHrefRow').style.display = cfg.add[idx].type === 'button' ? '' : 'none';
  $('pDup').style.display = '';
  boxOver(selBox, selectedEl); if (hlBox) hlBox.style.display = 'none';
  $('propPanel').hidden = false; $('pTag').textContent = '➕ ' + cfg.add[idx].type;
  $('pBread').innerHTML = ''; fillPanel(); buildLayers();
}
function addElement(type) {
  snap(); cfg.add = cfg.add || [];
  const win = frameWin();
  const x = win ? Math.round(win.innerWidth / 2 - 90) : 120;
  const y = win ? Math.round(win.innerHeight / 2 - 30) : 120;
  const id = 'ub_' + Math.random().toString(36).slice(2, 8);
  const it = { id, type, x, y, style: {} };
  if (type === 'text') it.text = 'Texto nuevo';
  else if (type === 'button') { it.text = 'Botón'; it.href = ''; }
  else if (type === 'image') { it.src = ''; it.style = { width: '200px' }; }
  else if (type === 'circle') { it.type = 'box'; it.style = { width: '120px', height: '120px', 'background-color': '#5f9bff', 'border-radius': '999px' }; }
  else if (type === 'line') { it.type = 'box'; it.style = { width: '240px', height: '3px', 'background-color': '#5f9bff', 'border-radius': '2px' }; }
  else { it.type = 'box'; it.style = { width: '160px', height: '90px', 'background-color': '#5f9bff', 'border-radius': '12px' }; }
  cfg.add.push(it); applyAll(); buildLayers(); selectAdd(cfg.add.length - 1);
  if (!inspectOn) toggleInspect();
  if (type === 'image') openPicker().then((u) => { if (u && cfg.add[addIndex]) { cfg.add[addIndex].src = u; applyAll(); } });
}
function buildBread(el) {
  const b = $('pBread'); b.innerHTML = ''; const chain = []; let n = el;
  while (n && n.nodeType === 1 && n.tagName !== 'BODY' && chain.length < 6) { chain.unshift(n); n = n.parentNode; }
  chain.forEach((node) => { const cr = document.createElement('span'); cr.className = 'cr' + (node === el ? ' cur' : ''); cr.textContent = node.tagName.toLowerCase(); cr.onclick = () => selectEl(node); b.appendChild(cr); });
}
function onFrameLoad() {
  const doc = frameDoc(), win = frameWin(); if (!doc || !doc.body) return;
  if (!doc.getElementById('ub-inspect-style')) {
    const s = doc.createElement('style'); s.id = 'ub-inspect-style';
    s.textContent = '.__ubov{position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #5f9bff;border-radius:3px}.__ubhl{background:rgba(95,155,255,.14)}.__ubsel{border-color:#ff5db0}html.__ubinspect,html.__ubinspect *{cursor:grab !important}html.__ubinspect *:active{cursor:grabbing !important}.__ubh{position:fixed;width:11px;height:11px;margin:-6px 0 0 -6px;background:#fff;border:1.5px solid #ff5db0;border-radius:2px;z-index:2147483647;pointer-events:auto}.__ubh[data-dir=nw],.__ubh[data-dir=se]{cursor:nwse-resize!important}.__ubh[data-dir=ne],.__ubh[data-dir=sw]{cursor:nesw-resize!important}.__ubh[data-dir=n],.__ubh[data-dir=s]{cursor:ns-resize!important}.__ubh[data-dir=e],.__ubh[data-dir=w]{cursor:ew-resize!important}';
    doc.head.appendChild(s);
  }
  hlBox = doc.getElementById('__ubhl') || mkBox(doc, '__ubhl');
  selBox = doc.getElementById('__ubsel') || mkBox(doc, '__ubsel');
  makeHandles(doc);
  selectedEl = null; selector = null; $('propPanel').hidden = true;
  doc.addEventListener('mousemove', onFrameMove, true);
  doc.addEventListener('mousedown', onFrameDown, true);
  doc.addEventListener('click', onFrameClick, true);
  doc.addEventListener('dblclick', onFrameDblClick, true);
  win.addEventListener('scroll', repositionSel, true);
  win.addEventListener('resize', repositionSel, true);
  if (inspectOn) doc.documentElement.classList.add('__ubinspect');
  setTimeout(render, 60); setTimeout(render, 400);
}
function mkBox(doc, cls) { const d = doc.createElement('div'); d.id = cls; d.className = '__ubov ' + cls; d.style.display = 'none'; doc.body.appendChild(d); return d; }
function selectable(t) { return t && t.nodeType === 1 && t !== hlBox && t !== selBox && !(t.classList && t.classList.contains('__ubh')); }
function placeHandles(r) {
  if (!handles) return;
  const show = !!selectedEl && inspectOn;
  for (const d in handles) { const h = handles[d]; if (!show) { h.style.display = 'none'; continue; } h.style.display = 'block';
    h.style.left = (d.includes('w') ? r.left : d.includes('e') ? r.right : r.left + r.width / 2) + 'px';
    h.style.top = (d.includes('n') ? r.top : d.includes('s') ? r.bottom : r.top + r.height / 2) + 'px';
  }
}
function makeHandles(doc) {
  handles = {};
  ['nw','n','ne','e','se','s','sw','w'].forEach((d) => {
    let h = doc.getElementById('__ubh_' + d);
    if (!h) { h = doc.createElement('div'); h.id = '__ubh_' + d; h.className = '__ubh'; h.dataset.dir = d; h.style.display = 'none'; h.addEventListener('mousedown', onHandleDown, true); doc.body.appendChild(h); }
    handles[d] = h;
  });
}
function onHandleDown(e) {
  if (!selectedEl) return; e.preventDefault(); e.stopPropagation();
  const dir = e.currentTarget.dataset.dir, doc = frameDoc();
  const r = selectedEl.getBoundingClientRect(), startX = e.clientX, startY = e.clientY, sw = r.width, sh = r.height;
  const o = curObj(); if (!o) return; snap(); o.style = o.style || {};
  const base = selMode === 'add' ? { x:+o.x||0, y:+o.y||0 } : (o.move ? { ...o.move } : { x:0, y:0 });
  const mm = (ev) => {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    let nw = sw, nh = sh, px = base.x, py = base.y;
    if (dir.includes('e')) nw = Math.max(12, sw + dx);
    if (dir.includes('w')) { nw = Math.max(12, sw - dx); px = base.x + dx; }
    if (dir.includes('s')) nh = Math.max(12, sh + dy);
    if (dir.includes('n')) { nh = Math.max(12, sh - dy); py = base.y + dy; }
    if (dir !== 'n' && dir !== 's') o.style.width = Math.round(nw) + 'px';
    if (dir !== 'e' && dir !== 'w') o.style.height = Math.round(nh) + 'px';
    if (selMode === 'add') { o.x = Math.round(px); o.y = Math.round(py); }
    else if (dir.includes('w') || dir.includes('n')) o.move = { x: Math.round(px), y: Math.round(py) };
    applyAll();
  };
  const mu = () => { doc.removeEventListener('mousemove', mm, true); doc.removeEventListener('mouseup', mu, true); fillPanel(); };
  doc.addEventListener('mousemove', mm, true); doc.addEventListener('mouseup', mu, true);
}
function onFrameMove(e) { if (!inspectOn) { if (hlBox) hlBox.style.display = 'none'; return; } if (selectable(e.target)) boxOver(hlBox, e.target); }
function onFrameClick(e) { if (!inspectOn) return; e.preventDefault(); e.stopPropagation(); }
function onFrameDblClick(e) {
  if (!inspectOn) return; e.preventDefault(); e.stopPropagation();
  const addNode = e.target.closest && e.target.closest('[data-ubid]');
  if (addNode) { const idx = cfg.add.findIndex((a) => a.id === addNode.getAttribute('data-ubid')); selectAdd(idx); }
  else if (selectable(e.target)) selectEl(e.target);
  const t = $('pText'); if (t) { t.focus(); try { t.select(); } catch (_) {} }
}
function onFrameDown(e) {
  if (!inspectOn) return;
  if (e.target.classList && e.target.classList.contains('__ubh')) return;
  const addNode = e.target.closest && e.target.closest('[data-ubid]');
  if (!addNode && !selectable(e.target)) return;
  e.preventDefault(); e.stopPropagation();
  const doc = frameDoc(), startX = e.clientX, startY = e.clientY;
  let moved = false, snapped = false;
  if (addNode) {
    const idx = cfg.add.findIndex((a) => a.id === addNode.getAttribute('data-ubid'));
    if (idx < 0) return;
    const base = { x: +cfg.add[idx].x || 0, y: +cfg.add[idx].y || 0 };
    const mm = (ev) => { const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) { moved = true; if (!snapped) { snap(); snapped = true; } selectAdd(idx); }
      if (moved) { cfg.add[idx].x = Math.round(base.x + dx); cfg.add[idx].y = Math.round(base.y + dy); applyAll(); syncMoveInputs(); } };
    const mu = () => { doc.removeEventListener('mousemove', mm, true); doc.removeEventListener('mouseup', mu, true); if (!moved) selectAdd(idx); };
    doc.addEventListener('mousemove', mm, true); doc.addEventListener('mouseup', mu, true);
    return;
  }
  const target = e.target, sel = cssPath(target, frameWin());
  const base = (cfg.el[sel] && cfg.el[sel].move) ? { ...cfg.el[sel].move } : { x:0, y:0 };
  const mm = (ev) => { const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 3) { moved = true; if (!snapped) { snap(); snapped = true; } if (selectedEl !== target || selMode !== 'el') selectEl(target); }
    if (moved) { selMode = 'el'; selector = sel; ensureEl(); cfg.el[sel].move = { x: Math.round(base.x + dx), y: Math.round(base.y + dy) }; applyEl(doc); boxOver(selBox, target); syncMoveInputs(); } };
  const mu = () => { doc.removeEventListener('mousemove', mm, true); doc.removeEventListener('mouseup', mu, true); if (!moved) selectEl(target); };
  doc.addEventListener('mousemove', mm, true); doc.addEventListener('mouseup', mu, true);
}

/* ===== plantilla de componentes (exportar/editar/reimportar todo) ===== */
const COMPONENT_TPL = [
  { sel:'.track', label:'Tarjeta de pista', props:['background-color','border-color','border-radius','box-shadow','padding'] },
  { sel:'.t-title', label:'Título de pista', props:['color','font-size','font-weight'] },
  { sel:'.t-artist', label:'Nombre de artista', props:['color','font-size'] },
  { sel:'.t-genre', label:'Pill de género/etiqueta', props:['background-color','color','border-radius','font-size','padding'] },
  { sel:'.btn', label:'Botón', props:['background-color','color','border-radius','font-weight','padding'] },
  { sel:'.btn.primary', label:'Botón primario', props:['color','border-radius'] },
  { sel:'.icon-btn', label:'Botón de icono', props:['background-color','color','border-radius'] },
  { sel:'.play-lg', label:'Botón reproducir', props:['border-radius','border-color'] },
  { sel:'.act', label:'Acciones (me gusta, etc.)', props:['color','font-size'] },
  { sel:'.nav-item', label:'Ítem del menú lateral', props:['color','font-size','border-radius'] },
  { sel:'.tabs button', label:'Pestañas del feed', props:['color','font-size'] },
  { sel:'.count', label:'Contador del menú', props:['background-color','color','border-radius'] },
  { sel:'.icon-btn .badge', label:'Globo de avisos', props:['background-color','color'] },
  { sel:'.avatar', label:'Avatar', props:['border-radius'] },
  { sel:'.vbadge', label:'Icono verificado', props:['color','width'] },
  { sel:'.topbar', label:'Barra superior', props:['background-color','border-bottom-color'] },
  { sel:'.sidebar', label:'Menú lateral', props:['background-color','border-right-color'] },
  { sel:'.pl-card', label:'Tarjeta de playlist', props:['background-color','border-radius'] },
  { sel:'.ev-card', label:'Tarjeta de evento', props:['background-color','border-radius'] },
  { sel:'.eco-node', label:'Nodo de Ecosystems', props:['background-color','border-radius'] },
  { sel:'.mkt-card', label:'Tarjeta del mercado', props:['background-color','border-radius'] },
  { sel:'.comments', label:'Caja de comentarios', props:['background-color','border-radius'] },
  { sel:'.player', label:'Barra del reproductor', props:['background-color','border-color'] },
  { sel:'.player .now .cover', label:'Portada del reproductor', props:['border-radius','box-shadow'] },
  { sel:'.modal', label:'Ventana / modal', props:['background-color','border-radius','border-color'] },
  { sel:'.profile-cover-grad', label:'Portada de perfil (sin imagen)', props:['border-radius'] },
  { sel:'.profile-head .avatar', label:'Avatar de perfil', props:['border-radius'] },
  { sel:'.pstats', label:'Estadísticas de perfil', props:['background-color','border-radius','border-color'] },
  { sel:'.bottom-nav', label:'Barra inferior (móvil)', props:['background-color','border-color'] },
  { sel:'.convo', label:'Fila de chat', props:['border-radius'] },
  { sel:'.dm-bubble', label:'Burbuja de mensaje', props:['background-color','color','border-radius'] },
  { sel:'.ptop-row', label:'Fila “Destacadas”', props:['background-color','border-radius'] },
  { sel:'.tool-card', label:'Tarjeta de herramienta', props:['background-color','border-radius'] },
];
function cssVal(cs, p) { let v = (cs.getPropertyValue(p) || '').trim(); if (/color/.test(p) && /^rgb/.test(v)) v = rgb2hex(v); return v; }
function exportComponents() {
  const doc = frameDoc(), win = frameWin();
  const out = { _info: 'Plantilla de componentes UnderBro · edita los valores y reimpórtala (deja en blanco lo que no quieras cambiar).', components: {} };
  COMPONENT_TPL.forEach((c) => {
    const o = { label: c.label, style: {} };
    let cs = null; try { const elx = doc && doc.querySelector(c.sel); if (elx) cs = win.getComputedStyle(elx); } catch (_) {}
    const cur = (cfg.el && cfg.el[c.sel] && cfg.el[c.sel].style) || {};
    c.props.forEach((p) => { o.style[p] = (cur[p] != null) ? cur[p] : (cs ? cssVal(cs, p) : ''); });
    out.components[c.sel] = o;
  });
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'underbro-componentes.json'; a.click(); URL.revokeObjectURL(a.href);
  $('tplMsg').textContent = 'Plantilla exportada ✓';
}
function importComponents(e) {
  const file = e.target.files[0]; if (!file) { return; }
  const r = new FileReader();
  r.onload = () => {
    let comps; try { const data = JSON.parse(r.result); comps = data.components || data; } catch (_) { $('tplMsg').textContent = 'Archivo no válido.'; return; }
    if (!comps || typeof comps !== 'object') { $('tplMsg').textContent = 'Archivo no válido.'; return; }
    snap(); let n = 0;
    for (const sel in comps) {
      const st = (comps[sel] && comps[sel].style) ? comps[sel].style : comps[sel];
      if (!st || typeof st !== 'object') continue;
      cfg.el[sel] = cfg.el[sel] || {}; cfg.el[sel].style = cfg.el[sel].style || {};
      for (const p in st) { const v = st[p]; if (v === '' || v == null) delete cfg.el[sel].style[p]; else { cfg.el[sel].style[p] = v; n++; } }
      if (cfg.el[sel].style && !Object.keys(cfg.el[sel].style).length && !cfg.el[sel].text && !cfg.el[sel].hide) delete cfg.el[sel];
    }
    applyAll(); buildLayers(); $('tplMsg').textContent = `Plantilla aplicada (${n} estilos). Pulsa Publicar/Guardar.`;
  };
  r.readAsText(file); e.target.value = '';
}

/* ===== exportar / importar / publicar ===== */
function trimOrderHide(catalog, conf) {
  const def = catalog.map((c) => c[0]), order = conf.order || [];
  const same = order.length === def.length && order.every((k, i) => k === def[i]);
  const hidden = conf.hidden || [];
  if (same && !hidden.length) return null;
  const out = {}; if (!same) out.order = order; if (hidden.length) out.hidden = hidden; return out;
}
function buildOut() {
  const o = {};
  if (cfg.bg && cfg.bg.mode && cfg.bg.mode !== 'default') { const b = { mode: cfg.bg.mode }; ['color','c1','c2','angle','image','dim'].forEach((k) => { if (cfg.bg[k] != null && cfg.bg[k] !== '') b[k] = cfg.bg[k]; }); o.bg = b; }
  if (Object.keys(cfg.colors).length) o.colors = { ...cfg.colors };
  if (cfg.font.family && cfg.font.family !== 'system') o.font = { family: cfg.font.family };
  if (cfg.radius != null) o.radius = cfg.radius;
  if (cfg.name && cfg.name.trim()) o.name = cfg.name.trim();
  if (cfg.tagline && cfg.tagline.trim()) o.tagline = cfg.tagline.trim();
  if (cfg.logo && cfg.logo.trim()) o.logo = cfg.logo.trim();
  const t = trimOrderHide(TABS, cfg.tabs); if (t) o.tabs = t;
  const n = trimOrderHide(NAV, cfg.nav); if (n) o.nav = n;
  const el = {}; for (const s in (cfg.el || {})) { const v = cfg.el[s]; if (v && (v.text != null || v.img != null || v.hide || v.rot || (v.scale != null && v.scale !== 1) || v.blur || (v.bright != null && v.bright !== 100) || (v.anim && v.anim.name) || (v.move && (v.move.x || v.move.y)) || (v.style && Object.keys(v.style).length))) el[s] = v; }
  if (Object.keys(el).length) o.el = el;
  if (Array.isArray(cfg.add) && cfg.add.length) o.add = cfg.add;
  return o;
}
function exportTheme() {
  const blob = new Blob([JSON.stringify(buildOut(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'underbro-theme.json'; a.click(); URL.revokeObjectURL(a.href);
}
function importTheme(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => { try { snap(); cfg = mergeCfg(JSON.parse(r.result)); hydrateControls(); buildColorList(); buildLists(); render(); msg('Tema importado (revísalo y Publica). ✅'); } catch (_) { msg('Archivo no válido.'); } };
  r.readAsText(file); e.target.value = '';
}
async function publish() {
  $('publish').disabled = true; msg(mode === 'personal' ? 'Guardando…' : 'Publicando…');
  let error;
  if (mode === 'personal') ({ error } = await sb.from('user_site_config').upsert({ user_id: myId, config: buildOut(), updated_at: new Date().toISOString() }));
  else ({ error } = await sb.from('site_config').upsert({ id: 1, config: buildOut(), updated_at: new Date().toISOString() }));
  $('publish').disabled = false;
  if (error) { msg(/relation|exist|user_site_config|site_config|policy|row-level/i.test(error.message||'') ? (mode === 'personal' ? 'Falta user_site_config o no tienes permiso (ejecuta el SQL).' : 'Falta crear la tabla site_config (ejecuta el SQL).') : 'Error: ' + (error.message||'')); return; }
  setDirty(false); persistActive(); msg(mode === 'personal' ? '¡Guardado en TU web! Recárgala para verlo. ✅' : '¡Publicado! Los usuarios lo verán al recargar. ✅');
}
async function resetAll() {
  if (!confirm(mode === 'personal' ? '¿Restablecer TU web por defecto?' : '¿Restablecer TODA la apariencia para todos?')) return;
  snap(); cfg = defaults();
  try { if (mode === 'personal') await sb.from('user_site_config').upsert({ user_id: myId, config: {}, updated_at: new Date().toISOString() }); else await sb.from('site_config').upsert({ id: 1, config: {}, updated_at: new Date().toISOString() }); } catch (_) {}
  setDirty(false); closePanel(); hydrateControls(); buildColorList(); buildLists(); buildLayers(); render(); msg('Restablecido. ✅');
}
/* ===== admin: conceder/quitar permiso de personalización ===== */
async function initEditorsAdmin() {
  const sec = $('editorsSec'); if (!sec) return; sec.style.display = '';
  $('grantBtn').onclick = async () => {
    const u = $('grantUser').value.trim(); if (!u) return;
    $('editorsMsg').textContent = 'Buscando…';
    const { data, error } = await sb.from('profiles').select('id,username').ilike('username', u).limit(1);
    if (error || !data || !data.length) { $('editorsMsg').textContent = 'Usuario no encontrado.'; return; }
    const { error: e2 } = await sb.from('profiles').update({ can_customize: true }).eq('id', data[0].id);
    if (e2) { $('editorsMsg').textContent = 'No se pudo conceder (revisa el SQL/policy).'; return; }
    $('editorsMsg').textContent = 'Concedido a @' + (data[0].username || '') + ' ✓'; $('grantUser').value = ''; loadEditors();
  };
  loadEditors(); loadRequests();
}
async function loadRequests() {
  const list = $('reqList'); if (!list) return;
  const { data, error } = await sb.from('creator_requests').select('user_id,username,created_at').order('created_at', { ascending: true }).limit(100);
  if (error || !data || !data.length) { list.innerHTML = ''; return; }
  list.innerHTML = '<div class="hint" style="margin:0 0 5px;font-weight:700;color:var(--ink-2)">Solicitudes de creador</div>';
  data.forEach((r) => {
    const row = document.createElement('div'); row.className = 'layer-row';
    row.innerHTML = `<span class="ln">✨ @${(r.username || r.user_id.slice(0, 8))}</span><button data-a="ok" title="Conceder">✓</button><button data-a="no" title="Descartar">🗑</button>`;
    row.querySelector('[data-a="ok"]').onclick = async () => { await sb.from('profiles').update({ can_customize: true }).eq('id', r.user_id); await sb.from('creator_requests').delete().eq('user_id', r.user_id); loadRequests(); loadEditors(); };
    row.querySelector('[data-a="no"]').onclick = async () => { await sb.from('creator_requests').delete().eq('user_id', r.user_id); loadRequests(); };
    list.appendChild(row);
  });
}
async function loadEditors() {
  const list = $('editorsList'); if (!list) return; list.innerHTML = '<p class="hint" style="margin:0">Cargando…</p>';
  const { data, error } = await sb.from('profiles').select('id,username').eq('can_customize', true).limit(100);
  if (error) { list.innerHTML = '<p class="hint" style="margin:0">No se pudo listar (ejecuta el SQL).</p>'; return; }
  if (!data || !data.length) { list.innerHTML = '<p class="hint" style="margin:0">Nadie tiene permiso aún.</p>'; return; }
  list.innerHTML = '';
  data.forEach((p) => {
    const row = document.createElement('div'); row.className = 'layer-row';
    row.innerHTML = `<span class="ln">@${(p.username || p.id.slice(0, 8))}</span><button data-a="rev" title="Quitar permiso">🗑</button>`;
    row.querySelector('[data-a="rev"]').onclick = async () => { await sb.from('profiles').update({ can_customize: false }).eq('id', p.id); loadEditors(); };
    list.appendChild(row);
  });
}

/* ===== proyectos (guardados en este navegador) ===== */
const LSK = 'ub_editor_projects_v1';
let projects = { active: null, list: [] }, _saveT = 0;
function loadProjectsLS() { try { const p = JSON.parse(localStorage.getItem(LSK)); if (p && Array.isArray(p.list)) return p; } catch (_) {} return null; }
function saveProjectsLS() { try { localStorage.setItem(LSK, JSON.stringify(projects)); } catch (_) {} }
function newId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function activeProj() { return projects.list.find((p) => p.id === projects.active); }
function initProjects(liveCfg) {
  const saved = loadProjectsLS();
  if (saved && saved.list.length) { projects = saved; if (!activeProj()) projects.active = projects.list[0].id; cfg = mergeCfg(activeProj().cfg || {}); }
  else { const p = { id: newId(), name: 'En vivo', cfg: liveCfg, updated: Date.now() }; projects = { active: p.id, list: [p] }; cfg = mergeCfg(liveCfg); saveProjectsLS(); }
}
function persistActive() { const p = activeProj(); if (!p) return; p.cfg = JSON.parse(JSON.stringify(cfg)); p.updated = Date.now(); saveProjectsLS(); }
function scheduleSave() { const s = $('saveState'); if (s) s.textContent = 'Guardando…'; clearTimeout(_saveT); _saveT = setTimeout(() => { persistActive(); if (s) s.textContent = 'Guardado ✓'; }, 600); }
function refreshProjSel() { const sel = $('projSel'); if (!sel) return; sel.innerHTML = projects.list.map((p) => `<option value="${p.id}">${(p.name || 'Proyecto').replace(/[<>]/g, '')}</option>`).join(''); sel.value = projects.active; }
function loadActiveIntoEditor() { cfg = mergeCfg(activeProj().cfg || {}); history = []; future = []; setDirty(false); closePanel(); hydrateControls(); buildColorList(); buildLists(); buildLayers(); render(); updateUndo(); }
function switchProject(id) { persistActive(); projects.active = id; saveProjectsLS(); refreshProjSel(); loadActiveIntoEditor(); }
function projNew() { persistActive(); const p = { id: newId(), name: 'Proyecto ' + (projects.list.length + 1), cfg: defaults(), updated: Date.now() }; projects.list.push(p); projects.active = p.id; saveProjectsLS(); refreshProjSel(); loadActiveIntoEditor(); }
function projRename() { const p = activeProj(); if (!p) return; const n = prompt('Nombre del proyecto:', p.name); if (n != null) { p.name = n.trim() || p.name; saveProjectsLS(); refreshProjSel(); } }
function projDup() { persistActive(); const a = activeProj(); const p = { id: newId(), name: (a.name || 'Proyecto') + ' copia', cfg: JSON.parse(JSON.stringify(a.cfg)), updated: Date.now() }; projects.list.push(p); projects.active = p.id; saveProjectsLS(); refreshProjSel(); loadActiveIntoEditor(); }
function projDel() { if (projects.list.length <= 1) { alert('Debe quedar al menos un proyecto.'); return; } const a = activeProj(); if (!confirm(`¿Borrar el proyecto "${a.name}"? (no afecta a lo ya publicado)`)) return; projects.list = projects.list.filter((p) => p.id !== a.id); projects.active = projects.list[0].id; saveProjectsLS(); refreshProjSel(); loadActiveIntoEditor(); }

/* ===== panel de capas (elementos creados) ===== */
const LICON = { text: '🅣', image: '🖼️', button: '🔘', box: '▭' };
function buildLayers() {
  const c = $('layersList'); if (!c) return; const list = cfg.add || [];
  if (!list.length) { c.innerHTML = '<p class="hint" style="margin:0">Sin elementos creados. Usa ➕ en la barra del visor.</p>'; return; }
  c.innerHTML = '';
  list.forEach((it, i) => {
    const row = document.createElement('div'); row.className = 'layer-row' + (selMode === 'add' && addIndex === i ? ' sel' : '');
    const name = (it.type === 'text' || it.type === 'button') ? (it.text || it.type) : it.type;
    row.innerHTML = `<span class="ln">${LICON[it.type] || '▭'} ${String(name).slice(0, 18)}</span><button data-a="up" title="Subir">↑</button><button data-a="dn" title="Bajar">↓</button><button data-a="hide" title="Ocultar/Mostrar">${it.hide ? '🙈' : '👁'}</button><button data-a="del" title="Borrar">🗑</button>`;
    row.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; if (!inspectOn) toggleInspect(); selectAdd(i); };
    row.querySelector('[data-a="up"]').onclick = () => { if (i < list.length - 1) { snap(); [list[i + 1], list[i]] = [list[i], list[i + 1]]; if (selMode === 'add' && addIndex === i) addIndex = i + 1; applyAll(); buildLayers(); } };
    row.querySelector('[data-a="dn"]').onclick = () => { if (i > 0) { snap(); [list[i - 1], list[i]] = [list[i], list[i - 1]]; if (selMode === 'add' && addIndex === i) addIndex = i - 1; applyAll(); buildLayers(); } };
    row.querySelector('[data-a="hide"]').onclick = () => { snap(); it.hide = !it.hide; applyAll(); buildLayers(); };
    row.querySelector('[data-a="del"]').onclick = () => { snap(); list.splice(i, 1); if (selMode === 'add' && addIndex === i) closePanel(); applyAll(); buildLayers(); };
    c.appendChild(row);
  });
}

/* ===== disposición de ventanas del editor (layout) ===== */
const LYK = 'ub_editor_layout_v1';
let layout = { sideW: 400, sideCollapsed: false, propFloat: false, propX: 90, propY: 90, propW: 320, propH: 520 };
function loadLayout() { try { const l = JSON.parse(localStorage.getItem(LYK)); if (l && typeof l === 'object') layout = Object.assign(layout, l); } catch (_) {} }
function saveLayout() { try { localStorage.setItem(LYK, JSON.stringify(layout)); } catch (_) {} }
function positionGrip() {
  const g = $('pGrip'), p = $('propPanel'); if (!g || !p) return;
  if (layout.propFloat && !p.hidden) { const r = p.getBoundingClientRect(); g.style.display = 'block'; g.style.left = (r.right - 18) + 'px'; g.style.top = (r.bottom - 18) + 'px'; }
  else g.style.display = 'none';
}
function applyLayout() {
  document.documentElement.style.setProperty('--sideW', layout.sideW + 'px');
  $('edBody').classList.toggle('side-collapsed', layout.sideCollapsed);
  const p = $('propPanel');
  if (layout.propFloat) { p.classList.add('float'); p.style.left = layout.propX + 'px'; p.style.top = layout.propY + 'px'; p.style.width = layout.propW + 'px'; p.style.height = layout.propH + 'px'; }
  else { p.classList.remove('float'); p.style.left = p.style.top = p.style.width = p.style.height = ''; }
  positionGrip();
}
function wireLayout() {
  // ancho del panel de ajustes (arrastrar el divisor)
  $('sideDivider').onmousedown = (e) => { e.preventDefault(); const sx = e.clientX, w0 = layout.sideW;
    const mm = (ev) => { layout.sideW = Math.max(280, Math.min(680, w0 + ev.clientX - sx)); document.documentElement.style.setProperty('--sideW', layout.sideW + 'px'); };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); saveLayout(); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); };
  // plegar/desplegar ajustes
  $('btnSide').onclick = () => { layout.sideCollapsed = !layout.sideCollapsed; $('edBody').classList.toggle('side-collapsed', layout.sideCollapsed); $('btnSide').classList.toggle('on', layout.sideCollapsed); saveLayout(); };
  // pantalla completa
  $('btnFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); };
  document.addEventListener('fullscreenchange', () => { $('btnFull').classList.toggle('on', !!document.fullscreenElement); });
  // acoplar / flotar panel de propiedades
  $('pDock').onclick = () => { layout.propFloat = !layout.propFloat; if (layout.propFloat) { layout.propX = Math.max(20, window.innerWidth - 360); layout.propY = 80; } applyLayout(); saveLayout(); };
  // mover el panel flotante por su cabecera
  $('pHead').addEventListener('mousedown', (e) => { if (!layout.propFloat || e.target.tagName === 'BUTTON') return; e.preventDefault(); const sx = e.clientX, sy = e.clientY, x0 = layout.propX, y0 = layout.propY;
    const mm = (ev) => { layout.propX = Math.max(0, Math.min(window.innerWidth - 80, x0 + ev.clientX - sx)); layout.propY = Math.max(0, Math.min(window.innerHeight - 40, y0 + ev.clientY - sy)); const p = $('propPanel'); p.style.left = layout.propX + 'px'; p.style.top = layout.propY + 'px'; positionGrip(); };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); saveLayout(); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); });
  // redimensionar el panel flotante
  $('pGrip').onmousedown = (e) => { e.preventDefault(); const sx = e.clientX, sy = e.clientY, w0 = layout.propW, h0 = layout.propH;
    const mm = (ev) => { layout.propW = Math.max(240, w0 + ev.clientX - sx); layout.propH = Math.max(200, h0 + ev.clientY - sy); const p = $('propPanel'); p.style.width = layout.propW + 'px'; p.style.height = layout.propH + 'px'; positionGrip(); };
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); saveLayout(); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); };
  window.addEventListener('resize', positionGrip);
}

/* ===== mercado de webs (galería pública) ===== */
function openMarket() { $('market').hidden = false; $('marketMsg').textContent = ''; $('marketName').value = (activeProj() && activeProj().name) || 'Mi web'; const sh = $('marketShare'); if (sh) sh.textContent = isAdminMode() ? '⬆ Compartir mi diseño' : '📤 Enviar a revisión'; loadMarket(); }
function closeMarket() { $('market').hidden = true; }
async function shareTheme() {
  const name = ($('marketName').value || '').trim() || 'Mi web';
  $('marketMsg').textContent = 'Compartiendo…';
  const { error } = await sb.from('theme_market').insert({ author: myId, author_name: myName || null, name, config: buildOut() });
  if (error) { $('marketMsg').textContent = /relation|exist|theme_market/i.test(error.message||'') ? 'Falta crear theme_market (ejecuta el SQL).' : (/policy|row-level/i.test(error.message||'') ? 'No tienes permiso para compartir.' : 'Error: ' + error.message); return; }
  $('marketMsg').textContent = isAdminMode() ? '¡Compartido en el mercado! ✅' : 'Enviado ✅. Aparecerá en el mercado cuando un administrador lo apruebe.'; loadMarket();
}
async function loadMarket() {
  const grid = $('marketGrid'); grid.innerHTML = '<p class="hint">Cargando…</p>';
  let q = sb.from('theme_market').select('id,author,author_name,name,config,created_at').order('created_at', { ascending: false }).limit(120);
  if (!isAdminMode()) q = q.or(`approved.eq.true,author.eq.${myId}`);
  const { data, error } = await q;
  if (error) { grid.innerHTML = '<p class="hint">' + (/relation|exist|theme_market/i.test(error.message||'') ? 'Falta crear theme_market (ejecuta el SQL).' : 'No se pudo cargar.') + '</p>'; return; }
  if (!data || !data.length) { grid.innerHTML = '<p class="hint">Aún no hay webs en el mercado. ¡Comparte la tuya con el botón de arriba!</p>'; return; }
  grid.innerHTML = '';
  data.forEach((t) => {
    const c = t.config || {}, cols = c.colors || {}, acc = cols.accent || '#5f9bff';
    const bg = bgValue(c.bg) || cols.appbg || '#0a0d18';
    const canDel = (t.author === myId) || isAdminMode();
    const card = document.createElement('div'); card.className = 'mk-card';
    card.innerHTML = `<div class="mk-prev" style="background:${bg}"><span class="mk-dot" style="background:${acc}"></span><span class="mk-dot" style="background:${cols.accent2 || acc}"></span></div><div class="mk-name">${(t.name || 'Web').replace(/[<>]/g, '')}</div><div class="mk-author">@${(t.author_name || 'anónimo').replace(/[<>]/g, '')}</div><div class="row" style="gap:6px;margin-top:7px"><button class="btn sm" data-a="apply" style="flex:1">Aplicar</button>${canDel ? '<button class="btn sm" data-a="del">🗑</button>' : ''}</div>`;
    card.querySelector('[data-a="apply"]').onclick = () => applyMarketTheme(t);
    if (canDel) card.querySelector('[data-a="del"]').onclick = async () => { if (!confirm('¿Quitar esta web del mercado?')) return; await sb.from('theme_market').delete().eq('id', t.id); loadMarket(); };
    grid.appendChild(card);
  });
}
function applyMarketTheme(t) {
  persistActive();
  const p = { id: newId(), name: (t.name || 'Web') + ' (mercado)', cfg: mergeCfg(t.config || {}), updated: Date.now() };
  projects.list.push(p); projects.active = p.id; saveProjectsLS(); refreshProjSel(); loadActiveIntoEditor();
  closeMarket();
  msg('Tema cargado como proyecto nuevo. Personalízalo y pulsa "' + (mode === 'personal' ? 'Guardar mi web' : 'Publicar cambios') + '".');
}

/* ===== arranque ===== */
async function boot() {
  let session;
  try { session = (await sb.auth.getSession()).data.session; } catch (_) {}
  if (!session) return gate('Inicia sesión en la app primero (con tu cuenta de administrador).', true);
  let prof = null;
  try { ({ data: prof } = await sb.from('profiles').select('is_admin,can_customize,is_creator,username').eq('id', session.user.id).maybeSingle()); }
  catch (_) { ({ data: prof } = await sb.from('profiles').select('is_admin,can_customize').eq('id', session.user.id).maybeSingle()); }
  const isAdmin = !!(prof && prof.is_admin);
  const canCustom = !!(prof && (prof.can_customize || prof.is_creator || prof.is_admin));
  if (!canCustom) return gate('No tienes permiso para personalizar tu web. Pídeselo al administrador.', true);
  mode = isAdmin ? 'global' : 'personal'; myId = session.user.id; myName = (prof && prof.username) || '';
  let liveCfg = defaults();
  try {
    if (isAdmin) { const { data } = await sb.from('site_config').select('config').eq('id', 1).maybeSingle(); if (data && data.config) liveCfg = mergeCfg(data.config); }
    else { const { data } = await sb.from('user_site_config').select('config').eq('user_id', myId).maybeSingle(); if (data && data.config) liveCfg = mergeCfg(data.config); }
  } catch (_) {}
  initProjects(liveCfg);
  const ml = $('modeLabel'); if (ml) ml.textContent = isAdmin ? '· Web global (admin)' : '· Tu web personal';
  $('gate').style.display = 'none'; $('editor').style.display = 'flex';
  loadLayout();
  hydrateControls(); buildColorList(); buildLists(); buildLayers(); wire(); wireLayout(); applyLayout(); updateUndo(); refreshProjSel(); setDirty(false); loadLibrary();
  if (isAdmin) initEditorsAdmin();
  $('appFrame').addEventListener('load', onFrameLoad);
  if (frameDoc() && frameDoc().readyState === 'complete') onFrameLoad();
}
boot();
})();
